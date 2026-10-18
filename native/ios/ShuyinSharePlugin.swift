import Capacitor
import UIKit

@objc(ShuyinSharePlugin)
public class ShuyinSharePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShuyinSharePlugin"
    public let jsName = "ShuyinShare"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "shareFile", returnType: CAPPluginReturnPromise)
    ]

    @objc func shareFile(_ call: CAPPluginCall) {
        guard let encoded = call.getString("dataBase64"),
              let data = Data(base64Encoded: encoded),
              !data.isEmpty else {
            call.reject("分享文件数据无效")
            return
        }
        let requested = call.getString("fileName") ?? "书隐导出.epub"
        let safeName = requested.replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "\\", with: "_")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(safeName)
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            call.reject("暂存 EPUB 失败：\(error.localizedDescription)")
            return
        }
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("无法打开 iOS 分享面板")
                return
            }
            let activity = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            if let popover = activity.popoverPresentationController {
                popover.sourceView = presenter.view
                popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.maxY - 1, width: 1, height: 1)
                popover.permittedArrowDirections = []
            }
            activity.completionWithItemsHandler = { _, completed, _, error in
                try? FileManager.default.removeItem(at: url)
                if let error {
                    call.reject("分享失败：\(error.localizedDescription)")
                } else {
                    call.resolve(["completed": completed])
                }
            }
            presenter.present(activity, animated: true)
        }
    }
}
