import Capacitor
import Foundation
import Security

@objc(ShuyinSecureStorePlugin)
public class ShuyinSecureStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShuyinSecureStorePlugin"
    public let jsName = "ShuyinSecureStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "delete", returnType: CAPPluginReturnPromise)
    ]

    private let service = "com.shuyin.reader.secrets"
    private func query() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: "deepseek-api-key"]
    }

    @objc func get(_ call: CAPPluginCall) {
        var request = query()
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { call.resolve(["configured": false]); return }
        guard status == errSecSuccess, let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            call.reject("读取 iOS 安全存储失败（\(status)）"); return
        }
        call.resolve(["configured": true, "value": value])
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let value = call.getString("value")?.trimmingCharacters(in: .whitespacesAndNewlines),
              value.count >= 12, value.count <= 512 else {
            call.reject("API Key 长度无效"); return
        }
        let data = Data(value.utf8)
        let status = SecItemUpdate(query() as CFDictionary,
                                   [kSecValueData as String: data,
                                    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query()
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let addStatus = SecItemAdd(item as CFDictionary, nil)
            guard addStatus == errSecSuccess else { call.reject("保存 API Key 失败（\(addStatus)）"); return }
        } else if status != errSecSuccess {
            call.reject("更新 API Key 失败（\(status)）"); return
        }
        call.resolve(["configured": true])
    }

    @objc func delete(_ call: CAPPluginCall) {
        let status = SecItemDelete(query() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject("删除 API Key 失败（\(status)）"); return
        }
        call.resolve(["configured": false])
    }
}
