import AVFoundation
import Capacitor
import SherpaOnnx
import SherpaOnnxC

/// 离线神经语音（sherpa-onnx VITS）。
/// 模型放在 `public/tts/<模型目录>/`，由 CI 在打包时下载，不进源码仓库。
/// 没有模型时 status() 返回 installed=false，JS 侧自动回落到系统语音，不会崩。
///
/// 重要（v0.10.10 修白屏）：Capacitor 的插件方法默认在**主线程**执行。
/// 页面一初始化就会调 status()，如果它顺手把 18MB 的 onnx 模型加载了，
/// 主线程会被卡住好几秒——iOS 迟迟拿不到首帧，就一直停在白色启动图上，
/// 表现就是「打开 App 全白、什么都没有」。
/// 所以：status() 只查文件在不在（毫秒级）；任何模型加载/推理都放到 work 队列。
@objc(ShuyinNeuralTtsPlugin)
public class ShuyinNeuralTtsPlugin: CAPPlugin, CAPBridgedPlugin, AVAudioPlayerDelegate {
    public let identifier = "ShuyinNeuralTtsPlugin"
    public let jsName = "ShuyinNeuralTts"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    /// 串行队列：模型初始化与合成都在这里跑，永远不占主线程。
    private let work = DispatchQueue(label: "com.shuyin.neural-tts", qos: .userInitiated)
    /// 只保护几个短字段的读写；模型加载期间**不持锁**，避免主线程排队等它。
    private let state = NSLock()
    private var tts: SherpaOnnxOfflineTtsWrapper?
    private var loadedDir: String?
    private var player: AVAudioPlayer?
    private var workingFile: String?

    // MARK: - 模型定位

    private func modelRoot() -> String? {
        guard let resource = Bundle.main.resourcePath else { return nil }
        return resource + "/public/tts"
    }

    private func locateModel() -> String? {
        guard let root = modelRoot(), let names = try? FileManager.default.contentsOfDirectory(atPath: root) else { return nil }
        for name in names.sorted() where !name.hasPrefix(".") {
            let dir = root + "/" + name
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: dir, isDirectory: &isDir), isDir.boolValue else { continue }
            let files = (try? FileManager.default.contentsOfDirectory(atPath: dir)) ?? []
            let hasModel = files.contains { $0.hasSuffix(".onnx") && !$0.contains("json") }
            if hasModel { return dir }
        }
        return nil
    }

    private func first(_ dir: String, suffix: String) -> String? {
        let files = (try? FileManager.default.contentsOfDirectory(atPath: dir)) ?? []
        guard let name = files.first(where: { $0.hasSuffix(suffix) }) else { return nil }
        return dir + "/" + name
    }

    /// C 结构体要的是 C 字符串指针；模型是长生命周期单例，这里不回收。
    private func c(_ value: String?) -> UnsafePointer<CChar>? {
        guard let value, !value.isEmpty else { return nil }
        return UnsafePointer(strdup(value))
    }

    /// 只允许在 work 队列上调用。
    private func ensure(_ dir: String) -> SherpaOnnxOfflineTtsWrapper? {
        state.lock()
        let cached = tts
        let cachedDir = loadedDir
        state.unlock()
        if let cached, cachedDir == dir { return cached }

        guard let model = first(dir, suffix: ".onnx"), !model.hasSuffix(".json") else { return nil }
        let tokens = first(dir, suffix: "tokens.txt")
        let lexicon = first(dir, suffix: "lexicon.txt")
        let fsts = ["phone.fst", "number.fst"].compactMap { dir + "/" + $0 }.filter { FileManager.default.fileExists(atPath: $0) }

        var config = SherpaOnnxOfflineTtsConfig()
        config.model.vits.model = c(model)
        config.model.vits.tokens = c(tokens)
        config.model.vits.lexicon = c(lexicon)
        config.model.vits.data_dir = c(first(dir, suffix: "espeak-ng-data") ?? "")
        config.model.vits.noise_scale = 0.667
        config.model.vits.noise_scale_w = 0.8
        config.model.vits.length_scale = 1.0
        config.model.num_threads = 2
        config.model.debug = 0
        config.model.provider = c("cpu")
        if !fsts.isEmpty { config.rule_fsts = c(fsts.joined(separator: ",")) }
        config.max_num_sentences = 1
        config.silence_scale = 0.2

        let wrapper = SherpaOnnxOfflineTtsWrapper(config: &config)
        guard wrapper.tts != nil else { return nil }
        state.lock()
        tts = wrapper
        loadedDir = dir
        state.unlock()
        return wrapper
    }

    // MARK: - 对外方法

    @objc func status(_ call: CAPPluginCall) {
        // 绝不在这个方法里加载模型：它会在页面初始化时被调用，一旦变慢就是白屏。
        guard let dir = locateModel() else {
            call.resolve(["installed": false, "ready": false])
            return
        }
        state.lock()
        let ready = tts != nil
        let speakers = tts.map { Int($0.numSpeakers) } ?? 0
        let sampleRate = tts.map { Int($0.sampleRate) } ?? 0
        state.unlock()

        var info: [String: Any] = [
            "installed": true,
            "ready": ready,
            "dir": (dir as NSString).lastPathComponent
        ]
        if ready {
            info["speakers"] = speakers
            info["sampleRate"] = sampleRate
        }
        call.resolve(info)
    }

    @objc func speak(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else {
            call.reject("朗读内容为空")
            return
        }
        let speed = Float(max(0.5, min(2.0, call.getDouble("speed") ?? 1.0)))
        let sid = max(0, Int(call.getInt("sid") ?? 0))
        stopPlayback()

        // 定位目录、加载模型、合成，全部在后台队列；主线程只负责最后播放。
        work.async { [weak self] in
            guard let self else { return }
            guard let dir = self.locateModel(), let engine = self.ensure(dir) else {
                DispatchQueue.main.async { call.reject("离线语音模型未安装") }
                return
            }
            let started = Date()
            let audio = engine.generate(text: text, sid: sid, speed: speed)
            let seconds = audio.sampleRate > 0 ? Double(audio.n) / Double(audio.sampleRate) : 0
            guard audio.n > 0 else {
                DispatchQueue.main.async { call.reject("模型没有生成音频") }
                return
            }
            let file = NSTemporaryDirectory() + "shuyin-neural.wav"
            let ok = audio.save(filename: file)
            DispatchQueue.main.async {
                guard ok > 0 else { call.reject("音频写入失败"); return }
                do {
                    try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
                    try AVAudioSession.sharedInstance().setActive(true)
                    self.player = try AVAudioPlayer(contentsOf: URL(fileURLWithPath: file))
                    self.player?.delegate = self
                    self.workingFile = file
                    self.player?.prepareToPlay()
                    self.player?.play()
                    call.resolve(["seconds": seconds,
                                  "sampleRate": Int(audio.sampleRate),
                                  "ms": Int(Date().timeIntervalSince(started) * 1000)])
                } catch {
                    call.reject("播放失败：\(error.localizedDescription)")
                }
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        stopPlayback()
        call.resolve()
    }

    private func stopPlayback() {
        player?.stop()
        player = nil
        if let file = workingFile {
            try? FileManager.default.removeItem(atPath: file)
            workingFile = nil
        }
    }

    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        workingFile.map { try? FileManager.default.removeItem(atPath: $0) }
        workingFile = nil
        self.player = nil
        notifyListeners("neuralFinished", data: ["ok": flag])
    }
}
