import Capacitor
import Foundation
import ImageIO
import Vision

@objc(ShuyinOCRPlugin)
public class ShuyinOCRPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShuyinOCRPlugin"
    public let jsName = "ShuyinOCR"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "recognize", returnType: CAPPluginReturnPromise)
    ]

    @objc func recognize(_ call: CAPPluginCall) {
        guard let encoded = call.getString("imageBase64"),
              let data = Data(base64Encoded: encoded),
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            call.reject("OCR 图片数据无效")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate
                request.usesLanguageCorrection = true
                request.recognitionLanguages = ["zh-Hans", "en-US"]
                try VNImageRequestHandler(cgImage: image).perform([request])
                let lines = (request.results ?? [])
                    .compactMap { observation -> (CGFloat, CGFloat, String)? in
                        guard let text = observation.topCandidates(1).first?.string else { return nil }
                        return (observation.boundingBox.midY, observation.boundingBox.minX, text)
                    }
                    .sorted { lhs, rhs in
                        abs(lhs.0 - rhs.0) > 0.012 ? lhs.0 > rhs.0 : lhs.1 < rhs.1
                    }
                    .map { $0.2 }
                DispatchQueue.main.async { call.resolve(["text": lines.joined(separator: "\n")]) }
            } catch {
                DispatchQueue.main.async { call.reject("iOS Vision OCR 失败：\(error.localizedDescription)") }
            }
        }
    }
}
