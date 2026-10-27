import UIKit
import Capacitor

/// "Share my list as a PDF".
///
/// JavaScript builds a self-contained HTML report (src/share/report.ts); this plugin renders it to a
/// paginated US Letter PDF with WebKit's `UIMarkupTextPrintFormatter` + `UIPrintPageRenderer`, writes
/// it to a temporary file and presents the system share sheet (`UIActivityViewController`), so Mail,
/// Messages, WhatsApp, AirDrop and "Save to Files" all work and nothing is uploaded anywhere.
///
/// JS: `share({ html, fileName }) -> { completed, activity? }` (`completed: false` when the sheet was
/// cancelled; rejects when rendering fails), `render({ html }) -> { pages, bytes }` (render only).
///
/// Every page carries a small footer with the page number and the estimates disclaimer.
@objc(SharePdfPlugin)
public class SharePdfPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SharePdfPlugin"
    public let jsName = "SharePdf"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "render", returnType: CAPPluginReturnPromise)
    ]

    /// US Letter in PostScript points.
    static let pageSize = CGSize(width: 612, height: 792)
    /// Side / top margin; the bottom margin additionally holds the footer.
    static let margin: CGFloat = 40
    static let footerHeight: CGFloat = 24
    static let footerText = "Estimates from public data and AI research — confirm details with each college."
    /// Reports larger than this are refused before rendering (a list is a few hundred KB at most).
    static let maxHtmlBytes = 8 * 1024 * 1024

    struct RenderError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    // MARK: - Plugin methods

    @objc func share(_ call: CAPPluginCall) {
        guard let html = call.getString("html"), !html.isEmpty else {
            call.reject("Nothing to share: the report is empty.", "INVALID")
            return
        }
        let fileName = Self.safeFileName(call.getString("fileName"))
        DispatchQueue.main.async {
            let pdf: Data
            do {
                pdf = try Self.renderPdf(html: html).data
            } catch {
                call.reject("Couldn't create the PDF: \(error.localizedDescription)", "RENDER")
                return
            }
            let url: URL
            do {
                url = try Self.writeTemporary(pdf, fileName: fileName)
            } catch {
                call.reject("Couldn't save the PDF: \(error.localizedDescription)", "WRITE")
                return
            }
            guard let presenter = self.bridge?.viewController else {
                call.reject("Nothing to present the share sheet from.", "NO_VIEW")
                return
            }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            sheet.completionWithItemsHandler = { activity, completed, _, error in
                if let error = error {
                    call.reject("Sharing failed: \(error.localizedDescription)", "SHARE")
                    return
                }
                var payload: [String: Any] = ["completed": completed]
                if let activity = activity { payload["activity"] = activity.rawValue }
                call.resolve(payload)
            }
            // iPad shows the share sheet as a popover and needs an anchor.
            if let popover = sheet.popoverPresentationController {
                let view: UIView = presenter.view
                popover.sourceView = view
                popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY - 1, width: 1, height: 1)
                popover.permittedArrowDirections = []
            }
            presenter.present(sheet, animated: true)
        }
    }

    /// Render only: `{ pages, bytes }`. Used by tests and diagnostics.
    @objc func render(_ call: CAPPluginCall) {
        guard let html = call.getString("html"), !html.isEmpty else {
            call.reject("Nothing to render: the report is empty.", "INVALID")
            return
        }
        DispatchQueue.main.async {
            do {
                let result = try Self.renderPdf(html: html)
                call.resolve(["pages": result.pages, "bytes": result.data.count])
            } catch {
                call.reject("Couldn't create the PDF: \(error.localizedDescription)", "RENDER")
            }
        }
    }

    // MARK: - Rendering (main thread)

    /// HTML → paginated Letter PDF. Must run on the main thread (UIKit print formatters require it).
    /// Throws when the markup lays out to zero pages or the PDF comes out empty.
    static func renderPdf(html: String) throws -> (data: Data, pages: Int) {
        guard html.utf8.count <= maxHtmlBytes else {
            throw RenderError(message: "The report is too large to render.")
        }
        let formatter = UIMarkupTextPrintFormatter(markupText: html)
        formatter.perPageContentInsets = .zero

        let renderer = ReportPageRenderer()
        renderer.footerHeight = footerHeight
        let paper = CGRect(origin: .zero, size: pageSize)
        // UIKit reserves `footerHeight` at the bottom of the printable rect for drawFooterForPage.
        let printable = CGRect(
            x: margin, y: margin,
            width: pageSize.width - 2 * margin,
            height: pageSize.height - 2 * margin
        )
        // `paperRect` / `printableRect` are read-only in the public API; KVC is the documented way to
        // set them on a renderer that isn't driven by UIPrintInteractionController.
        renderer.setValue(NSValue(cgRect: paper), forKey: "paperRect")
        renderer.setValue(NSValue(cgRect: printable), forKey: "printableRect")
        renderer.addPrintFormatter(formatter, startingAtPageAt: 0)

        let pages = renderer.numberOfPages
        guard pages > 0 else {
            throw RenderError(message: "The report laid out to zero pages.")
        }

        let data = NSMutableData()
        UIGraphicsBeginPDFContextToData(data, paper, [
            kCGPDFContextTitle as String: "College list",
            kCGPDFContextCreator as String: "Tierwise"
        ])
        renderer.prepare(forDrawingPages: NSRange(location: 0, length: pages))
        let bounds = UIGraphicsGetPDFContextBounds()
        for index in 0..<pages {
            UIGraphicsBeginPDFPage()
            renderer.drawPage(at: index, in: bounds)
        }
        UIGraphicsEndPDFContext()

        guard data.length > 0 else {
            throw RenderError(message: "The PDF came out empty.")
        }
        return (data as Data, pages)
    }

    /// Writes the PDF to `tmp/cc-share/<fileName>`, replacing any earlier file of the same name.
    static func writeTemporary(_ data: Data, fileName: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("cc-share", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(fileName)
        try data.write(to: url, options: .atomic)
        return url
    }

    /// A file name that is safe on disk and ends in `.pdf`.
    static func safeFileName(_ raw: String?) -> String {
        var name = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let illegal = CharacterSet(charactersIn: "/\\:*?\"<>|").union(.controlCharacters).union(.newlines)
        name = name.components(separatedBy: illegal).joined(separator: " ")
        name = name.replacingOccurrences(of: "  ", with: " ").trimmingCharacters(in: CharacterSet(charactersIn: " ."))
        if name.isEmpty { name = "College list" }
        if name.count > 120 { name = String(name.prefix(120)) }
        if !name.lowercased().hasSuffix(".pdf") { name += ".pdf" }
        return name
    }

    // MARK: - CI self-test

    /// Renders a small sample report and returns `pdf_pages=N pdf_bytes=M` (or `pdf_error=…`), so the
    /// simulator smoke test can prove the native PDF path works. Main thread only.
    static func selfTestLine() -> String {
        do {
            let result = try renderPdf(html: sampleReportHtml)
            let line = "pdf_pages=\(result.pages) pdf_bytes=\(result.data.count)"
            NSLog("CC_SHAREPDF %@", line)
            return line
        } catch {
            let line = "pdf_error=\(error.localizedDescription)"
            NSLog("CC_SHAREPDF %@", line)
            return line
        }
    }

    /// Same structure as the real report (src/share/report.ts): header, snapshot table, one college block.
    static let sampleReportHtml = """
    <!doctype html>
    <html lang="en">
    <head>
    <meta charset="utf-8">
    <title>Sample list — Tierwise</title>
    <style>
    body { color: #111; font: 10.5pt/1.4 -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; margin: 0; }
    h1 { font-size: 20pt; margin: 0; }
    h2 { font-size: 13pt; margin: 12pt 0 6pt; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 3pt 8pt 3pt 0; border-bottom: 0.5pt solid #ddd; vertical-align: top; }
    article { border: 0.75pt solid #cfcfcf; border-radius: 6pt; padding: 7pt 10pt; margin: 0 0 7pt; page-break-inside: avoid; }
    </style>
    </head>
    <body>
    <header><h1>Sample list</h1><p>Prepared for Sam · Fall 2027 entry · 1 college</p></header>
    <h2>Student snapshot</h2>
    <table><tr><th>Intended majors</th><td>Computer science</td><th>Home state</th><td>North Carolina</td></tr></table>
    <h2>Target</h2>
    <article>
    <h3>Example University &amp; College</h3>
    <p>Raleigh, NC · Public · 27,000 undergrads</p>
    <table><tr><th>Estimated chance</th><th>Admit rate</th><th>SAT middle 50%</th><th>Testing</th></tr>
    <tr><td><b>50–69%</b> target</td><td>40%</td><td>1270–1430</td><td>Test-optional</td></tr></table>
    <p><b>Apply:</b> Early Action Nov 1, 2026 · Regular Decision Jan 15, 2027</p>
    <p><b>Why it's here:</b> Offers B.S. in Computer Science</p>
    </article>
    <footer>Estimates from public data and AI research — confirm details with each college.</footer>
    </body>
    </html>
    """
}

/// Draws the per-page footer: disclaimer on the left, "Page N of M" on the right.
final class ReportPageRenderer: UIPrintPageRenderer {
    override func drawFooterForPage(at pageIndex: Int, in footerRect: CGRect) {
        let font = UIFont.systemFont(ofSize: 7.5)
        let color = UIColor(white: 0.42, alpha: 1)
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: paragraph]

        let pageText = "Page \(pageIndex + 1) of \(numberOfPages)"
        let pageSize = (pageText as NSString).size(withAttributes: attrs)
        let pageRect = CGRect(
            x: footerRect.maxX - pageSize.width,
            y: footerRect.maxY - pageSize.height - 2,
            width: pageSize.width,
            height: pageSize.height
        )
        (pageText as NSString).draw(in: pageRect, withAttributes: attrs)

        let textRect = CGRect(
            x: footerRect.minX,
            y: pageRect.minY,
            width: max(0, pageRect.minX - footerRect.minX - 12),
            height: pageSize.height
        )
        (SharePdfPlugin.footerText as NSString).draw(in: textRect, withAttributes: attrs)
    }
}
