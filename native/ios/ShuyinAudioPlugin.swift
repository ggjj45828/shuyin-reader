import AVFoundation
import Capacitor
import MediaPlayer

@objc(ShuyinAudioPlugin)
public class ShuyinAudioPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "ShuyinAudioPlugin"
    public let jsName = "ShuyinAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "voices", returnType: CAPPluginReturnPromise)
    ]

    private let synthesizer = AVSpeechSynthesizer()
    private var fileSynthesizer: AVSpeechSynthesizer?
    private var audioFile: AVAudioFile?
    private var fileCall: CAPPluginCall?
    private var remoteCommandsInstalled = false
    private var speechQueue: [[String: String]] = []
    private var queueIndex = 0
    private var speechVoice: String?
    private var speechRate: Double = 1
    private var speechVolume: Double = 1
    private var speechPitch: Double = 1

    public override func load() {
        synthesizer.delegate = self
        activateAudioSession()
        installRemoteCommands()
    }

    private func activateAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio, options: [.allowAirPlay, .allowBluetoothA2DP])
            try session.setActive(true)
        } catch { notifyListeners("audioError", data: ["message": error.localizedDescription]) }
    }

    private func voice(_ code: String?) -> AVSpeechSynthesisVoice? {
        if let identifier = code,
           let exact = AVSpeechSynthesisVoice.speechVoices().first(where: { $0.identifier == identifier }),
           exact.language.lowercased().hasPrefix("zh") { return exact }
        let preferred: String
        switch code {
        case "male", "zm_yunjian", "zm_yunxi", "zm_yunyang": preferred = "zh-CN"
        default: preferred = "zh-CN"
        }
        return AVSpeechSynthesisVoice(language: preferred)
    }

    @objc func voices(_ call: CAPPluginCall) {
        let rows = AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.lowercased().hasPrefix("zh") }
            .map { item -> [String: Any] in
                let quality: String
                if #available(iOS 16.0, *), item.quality == .premium { quality = "premium" }
                else if item.quality == .enhanced { quality = "enhanced" }
                else { quality = "standard" }
                return ["identifier": item.identifier, "name": item.name,
                        "language": item.language, "quality": quality]
            }
            .sorted { a, b in
                let rank: [String: Int] = ["premium": 0, "enhanced": 1, "standard": 2]
                return (rank[a["quality"] as? String ?? "standard"] ?? 2) < (rank[b["quality"] as? String ?? "standard"] ?? 2)
            }
        call.resolve(["voices": rows])
    }

    @objc func speak(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else { call.reject("朗读内容为空"); return }
        activateAudioSession()
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
        speechVoice = call.getString("voice")
        speechRate = call.getDouble("rate") ?? 1
        speechVolume = call.getDouble("volume") ?? 1
        speechPitch = call.getDouble("pitch") ?? 1
        let incoming = call.getArray("queue") ?? []
        speechQueue = incoming.compactMap { $0 as? [String: String] }.filter { !($0["text"] ?? "").isEmpty }
        if speechQueue.isEmpty { speechQueue = [["text": text, "title": call.getString("title") ?? "书隐听书", "artist": call.getString("artist") ?? "书隐"]] }
        queueIndex = 0
        speakQueueItem()
        call.resolve(["started": true])
    }

    private func speakQueueItem() {
        guard speechQueue.indices.contains(queueIndex) else { return }
        let item = speechQueue[queueIndex]
        let utterance = AVSpeechUtterance(string: item["text"] ?? "")
        utterance.voice = voice(speechVoice)
        // 系统语速 0…1，0.5 是默认。旧版死夹在 0.45～0.62，倍速基本无效；
        // 现在按 0.5×倍速 映射并只保留安全边界（0.28 很慢、0.82 很快）。
        utterance.rate = Float(max(0.28, min(0.82, 0.5 * speechRate)))
        utterance.volume = Float(max(0, min(1, speechVolume)))
        utterance.pitchMultiplier = Float(max(0.5, min(2, speechPitch)))
        utterance.preUtteranceDelay = 0
        utterance.postUtteranceDelay = 0
        // 锁屏要一条能动的进度条：系统语音不报时长，按约每秒 4.5 字估算。
        let estimate = max(1.0, Double((item["text"] ?? "").count) / 4.5)
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: item["title"] ?? "书隐听书",
            MPMediaItemPropertyArtist: item["artist"] ?? "书隐",
            MPMediaItemPropertyPlaybackDuration: estimate,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: Double(Int(item["offset"] ?? "0") ?? 0) / 4.5,
            MPNowPlayingInfoPropertyPlaybackRate: 1.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0
        ]
        synthesizer.speak(utterance)
    }

    @objc func pause(_ call: CAPPluginCall) {
        _ = synthesizer.pauseSpeaking(at: .immediate)
        MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPNowPlayingInfoPropertyPlaybackRate] = 0.0
        call.resolve()
    }

    @objc func resume(_ call: CAPPluginCall) {
        activateAudioSession()
        _ = synthesizer.continueSpeaking()
        MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPNowPlayingInfoPropertyPlaybackRate] = 1.0
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        synthesizer.stopSpeaking(at: .immediate)
        speechQueue = []
        queueIndex = 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        call.resolve()
    }

    private func skip(_ delta: Int) -> MPRemoteCommandHandlerStatus {
        let target = queueIndex + delta
        guard speechQueue.indices.contains(target), speechQueue.count > 1 else {
            notifyListeners("remoteCommand", data: ["command": delta > 0 ? "next" : "previous"])
            return .success
        }
        synthesizer.stopSpeaking(at: .immediate)
        queueIndex = target
        speakQueueItem()
        notifyListeners("speechChapter", data: ["index": Int(speechQueue[queueIndex]["index"] ?? "") ?? queueIndex, "title": speechQueue[queueIndex]["title"] ?? ""])
        return .success
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString characterRange: NSRange, utterance: AVSpeechUtterance) {
        guard synthesizer === self.synthesizer, speechQueue.indices.contains(queueIndex) else { return }
        let item = speechQueue[queueIndex]
        let base = Int(item["offset"] ?? "0") ?? 0
        let absolute = base + characterRange.location
        if var info = MPNowPlayingInfoCenter.default().nowPlayingInfo {
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = Double(absolute) / 4.5
            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        }
        notifyListeners("speechProgress", data: [
            "index": Int(item["index"] ?? "0") ?? queueIndex,
            "location": absolute,
            "length": characterRange.length,
            "title": item["title"] ?? ""
        ])
    }

    @objc func saveAudio(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else { call.reject("本章没有可保存的正文"); return }
        guard fileCall == nil else { call.reject("已有音频任务正在生成"); return }
        let safe = String((call.getString("title") ?? "本章").unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || CharacterSet(charactersIn: " -_").contains($0) }.prefix(48))
        let name = "书隐-\(safe.isEmpty ? "本章" : safe)-\(Int(Date().timeIntervalSince1970)).caf"
        let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Audio", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let destination = folder.appendingPathComponent(name)
            let speech = AVSpeechSynthesizer()
            speech.delegate = self
            fileCall = call
            fileSynthesizer = speech
            audioFile = nil
            call.keepAlive = true
            let utterance = AVSpeechUtterance(string: text)
            utterance.voice = voice(call.getString("voice"))
            utterance.rate = Float(max(0.28, min(0.82, 0.5 * (call.getDouble("rate") ?? 1))))
            utterance.volume = Float(max(0, min(1, call.getDouble("volume") ?? 1)))
            utterance.pitchMultiplier = Float(max(0.5, min(2, call.getDouble("pitch") ?? 1)))
            speech.write(utterance) { [weak self] buffer in
                guard let self, let pcm = buffer as? AVAudioPCMBuffer else { return }
                do {
                    if pcm.frameLength == 0 {
                        self.audioFile = nil
                        self.fileSynthesizer = nil
                        DispatchQueue.main.async {
                            self.fileCall?.resolve(["fileName": name, "path": destination.path])
                            self.fileCall = nil
                        }
                        return
                    }
                    if self.audioFile == nil { self.audioFile = try AVAudioFile(forWriting: destination, settings: pcm.format.settings) }
                    try self.audioFile?.write(from: pcm)
                } catch {
                    DispatchQueue.main.async {
                        self.fileCall?.reject("音频写入失败：\(error.localizedDescription)")
                        self.fileCall = nil
                        self.audioFile = nil
                        self.fileSynthesizer = nil
                        try? FileManager.default.removeItem(at: destination)
                    }
                }
            }
        } catch { call.reject("无法创建音频文件：\(error.localizedDescription)") }
    }

    private func installRemoteCommands() {
        guard !remoteCommandsInstalled else { return }
        remoteCommandsInstalled = true
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in self?.notifyListeners("remoteCommand", data: ["command": "play"]); return .success }
        center.pauseCommand.addTarget { [weak self] _ in self?.notifyListeners("remoteCommand", data: ["command": "pause"]); return .success }
        center.nextTrackCommand.addTarget { [weak self] _ in self?.skip(1) ?? .commandFailed }
        center.previousTrackCommand.addTarget { [weak self] _ in self?.skip(-1) ?? .commandFailed }
        center.changePlaybackPositionCommand.isEnabled = false
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        if synthesizer === fileSynthesizer { return }
        if queueIndex + 1 < speechQueue.count {
            queueIndex += 1
            speakQueueItem()
            notifyListeners("speechChapter", data: ["index": Int(speechQueue[queueIndex]["index"] ?? "") ?? queueIndex, "title": speechQueue[queueIndex]["title"] ?? ""])
        } else {
            speechQueue = []
            queueIndex = 0
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            notifyListeners("speechFinished", data: [:])
        }
    }
}
