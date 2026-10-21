import UIKit
import Capacitor
import UserNotifications

/// Application-deadline reminders and "Add to Calendar".
///
/// JavaScript (src/deadlines/) decides *what* to remind about — one notification 7 days and one the day
/// before each deadline day at 9:00 local time, colleges due the same day grouped — and hands the finished
/// list here. This plugin only turns it into pending `UNNotificationRequest`s with calendar triggers.
/// Every deadline reminder's identifier starts with a common prefix (`cc-deadline:`), so re-scheduling is
/// idempotent: remove everything with the prefix, then add the new set. The research-ready notification
/// (`cc-research-ready`, BackgroundTransfers.swift) has a different identifier and is never touched.
///
/// JS: `schedule({ prefix, reminders: [{ id, title, body, fireAt }] }) -> { scheduled }` (`fireAt` is epoch
/// milliseconds), `clear({ prefix }) -> { removed }`, `pending({ prefix }) -> { ids }`,
/// `shareCalendar({ ics, fileName }) -> { completed }` (writes the .ics to a temporary file and presents the
/// share sheet, so Calendar, Mail, Files… can take it).
@objc(DeadlineRemindersPlugin)
public class DeadlineRemindersPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeadlineRemindersPlugin"
    public let jsName = "DeadlineReminders"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareCalendar", returnType: CAPPluginReturnPromise)
    ]

    /// iOS keeps at most 64 pending local notifications per app; JavaScript already caps lower (60).
    static let maxReminders = 64
    /// The .ics is a few KB per deadline; anything bigger than this is not a deadlines export.
    static let maxIcsBytes = 2 * 1024 * 1024

    // MARK: - Plugin methods

    @objc func schedule(_ call: CAPPluginCall) {
        guard let prefix = call.getString("prefix"), !prefix.isEmpty else {
            call.reject("A reminder prefix is required.", "INVALID")
            return
        }
        let raw = call.getArray("reminders") as? [[String: Any]] ?? []
        let reminders = raw.compactMap(Self.reminder(from:)).prefix(Self.maxReminders)
        Self.schedule(prefix: prefix, reminders: Array(reminders)) { scheduled in
            call.resolve(["scheduled": scheduled])
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        guard let prefix = call.getString("prefix"), !prefix.isEmpty else {
            call.reject("A reminder prefix is required.", "INVALID")
            return
        }
        Self.serialized { done in
            Self.removePending(prefix: prefix) { removed in
                call.resolve(["removed": removed])
                done()
            }
        }
    }

    @objc func pending(_ call: CAPPluginCall) {
        let prefix = call.getString("prefix") ?? ""
        UNUserNotificationCenter.current().getPendingNotificationRequests { requests in
            let ids = requests.map { $0.identifier }.filter { prefix.isEmpty || $0.hasPrefix(prefix) }.sorted()
            call.resolve(["ids": ids])
        }
    }

    @objc func shareCalendar(_ call: CAPPluginCall) {
        guard let ics = call.getString("ics"), !ics.isEmpty else {
            call.reject("Nothing to share: the calendar is empty.", "INVALID")
            return
        }
        guard ics.utf8.count <= Self.maxIcsBytes else {
            call.reject("The calendar file is too large to share.", "INVALID")
            return
        }
        let fileName = Self.safeFileName(call.getString("fileName"))
        DispatchQueue.main.async {
            let url: URL
            do {
                url = try Self.writeTemporary(Data(ics.utf8), fileName: fileName)
            } catch {
                call.reject("Couldn't save the calendar file: \(error.localizedDescription)", "WRITE")
                return
            }
            guard let presenter = self.bridge?.viewController else {
                call.reject("Nothing to present the share sheet from.", "NO_VIEW")
                return
            }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            sheet.completionWithItemsHandler = { _, completed, _, error in
                if let error = error {
                    call.reject("Sharing failed: \(error.localizedDescription)", "SHARE")
                    return
                }
                call.resolve(["completed": completed])
            }
            if let popover = sheet.popoverPresentationController {
                let view: UIView = presenter.view
                popover.sourceView = view
                popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY - 1, width: 1, height: 1)
                popover.permittedArrowDirections = []
            }
            presenter.present(sheet, animated: true)
        }
    }

    // MARK: - Scheduling

    struct Reminder {
        let id: String
        let title: String
        let body: String
        let fireAt: Date
    }

    /// A reminder from its JS shape; nil when a field is missing or the time is not in the future.
    static func reminder(from dict: [String: Any]) -> Reminder? {
        guard let id = dict["id"] as? String, !id.isEmpty,
              let title = dict["title"] as? String, !title.isEmpty else { return nil }
        let body = dict["body"] as? String ?? ""
        let ms: Double
        if let n = dict["fireAt"] as? NSNumber { ms = n.doubleValue }
        else if let s = dict["fireAt"] as? String, let n = Double(s) { ms = n }
        else { return nil }
        let fireAt = Date(timeIntervalSince1970: ms / 1000)
        guard fireAt.timeIntervalSinceNow > 0 else { return nil }
        return Reminder(id: id, title: title, body: body, fireAt: fireAt)
    }

    /// Remove every pending request whose identifier has `prefix`, then add `reminders` (calendar
    /// triggers in the current time zone). Completion gets the number added.
    /// Replacements run one at a time: a newer schedule (e.g. reminders turned off) must never be
    /// overtaken by an older one that was still adding its requests.
    static let serial = DispatchQueue(label: "cc.deadline-reminders")

    /// Runs `work` on the serial queue and waits for it to call `done` before starting the next one.
    static func serialized(_ work: @escaping (@escaping () -> Void) -> Void) {
        serial.async {
            let finished = DispatchSemaphore(value: 0)
            work { finished.signal() }
            finished.wait()
        }
    }

    static func schedule(prefix: String, reminders: [Reminder], completion: @escaping (Int) -> Void) {
        serialized { done in
            replace(prefix: prefix, reminders: reminders) { added in
                completion(added)
                done()
            }
        }
    }

    /// True when iOS will actually deliver local notifications (adding a request without permission
    /// "succeeds" but nothing is scheduled).
    static func notificationsAllowed(_ completion: @escaping (Bool) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral: completion(true)
            default: completion(false)
            }
        }
    }

    private static func replace(prefix: String, reminders: [Reminder], completion: @escaping (Int) -> Void) {
        removePending(prefix: prefix) { _ in
            let center = UNUserNotificationCenter.current()
            guard !reminders.isEmpty else {
                completion(0)
                return
            }
            notificationsAllowed { allowed in
            guard allowed else {
                completion(0)
                return
            }
            let group = DispatchGroup()
            let lock = NSLock()
            var added = 0
            for r in reminders {
                let content = UNMutableNotificationContent()
                content.title = r.title
                content.body = r.body
                content.sound = .default
                content.threadIdentifier = "cc-deadlines"
                let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: r.fireAt)
                let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
                group.enter()
                center.add(UNNotificationRequest(identifier: r.id, content: content, trigger: trigger)) { error in
                    if error == nil {
                        lock.lock(); added += 1; lock.unlock()
                    } else {
                        NSLog("CC_DEADLINES add %@ failed: %@", r.id, error!.localizedDescription)
                    }
                    group.leave()
                }
            }
            group.notify(queue: .global()) { completion(added) }
            }
        }
    }

    static func removePending(prefix: String, completion: @escaping (Int) -> Void) {
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { requests in
            let ids = requests.map { $0.identifier }.filter { $0.hasPrefix(prefix) }
            if !ids.isEmpty { center.removePendingNotificationRequests(withIdentifiers: ids) }
            completion(ids.count)
        }
    }

    // MARK: - Files

    /// Writes the data to `tmp/cc-share/<fileName>`, replacing any earlier file of the same name.
    static func writeTemporary(_ data: Data, fileName: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("cc-share", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(fileName)
        try data.write(to: url, options: .atomic)
        return url
    }

    /// A file name that is safe on disk and ends in `.ics`.
    static func safeFileName(_ raw: String?) -> String {
        var name = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let illegal = CharacterSet(charactersIn: "/\\:*?\"<>|").union(.controlCharacters).union(.newlines)
        name = name.components(separatedBy: illegal).joined(separator: " ")
        name = name.replacingOccurrences(of: "  ", with: " ").trimmingCharacters(in: CharacterSet(charactersIn: " ."))
        if name.isEmpty { name = "College deadlines" }
        if name.count > 120 { name = String(name.prefix(120)) }
        if !name.lowercased().hasSuffix(".ics") { name += ".ics" }
        return name
    }

    // MARK: - CI self-test

    /// Schedules two reminders under a test prefix, counts them, clears them and counts again:
    /// `reminders_pending=2 cleared=0`. Where notifications aren't allowed (the Simulator never grants
    /// them unattended) iOS refuses `add`, and the line is `reminders_skipped=not-allowed` — the plugin
    /// still ran end to end (remove / list / remove). Any other outcome is `reminders_error=…`.
    static func selfTest(completion: @escaping (String) -> Void) {
        let prefix = "cc-selftest-deadline:"
        let soon = Date().addingTimeInterval(3600)
        let reminders = [
            Reminder(id: prefix + "a", title: "Test · Early Action due in 7 days — Nov 1", body: "Self-test", fireAt: soon),
            Reminder(id: prefix + "b", title: "Test · Early Action due tomorrow — Nov 1", body: "Self-test", fireAt: soon.addingTimeInterval(60))
        ]
        notificationsAllowed { allowed in
        schedule(prefix: prefix, reminders: reminders) { added in
            UNUserNotificationCenter.current().getPendingNotificationRequests { requests in
                let pending = requests.filter { $0.identifier.hasPrefix(prefix) }.count
                removePending(prefix: prefix) { _ in
                    UNUserNotificationCenter.current().getPendingNotificationRequests { after in
                        let left = after.filter { $0.identifier.hasPrefix(prefix) }.count
                        let line: String
                        if added == 2 && pending == 2 && left == 0 {
                            line = "reminders_pending=\(pending) cleared=\(left)"
                        } else if !allowed && added == 0 && pending == 0 && left == 0 {
                            line = "reminders_skipped=not-allowed"
                        } else {
                            line = "reminders_error=added:\(added) pending:\(pending) left:\(left)"
                        }
                        NSLog("CC_DEADLINES %@", line)
                        completion(line)
                    }
                }
            }
        }
        }
    }
}
