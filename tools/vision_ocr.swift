import Foundation
import Vision

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: vision_ocr.swift <image-directory>\n".utf8))
    exit(2)
}

let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let manager = FileManager.default
let files = (try manager.contentsOfDirectory(at: root, includingPropertiesForKeys: nil))
    .filter { ["png", "jpg", "jpeg", "webp"].contains($0.pathExtension.lowercased()) }
    .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }

for file in files {
    autoreleasepool {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        if #available(macOS 13.0, *) {
            request.automaticallyDetectsLanguage = true
        }

        do {
            try VNImageRequestHandler(url: file).perform([request])
            let observations = (request.results ?? []).sorted {
                let yDelta = $0.boundingBox.midY - $1.boundingBox.midY
                if abs(yDelta) > 0.02 { return yDelta > 0 }
                return $0.boundingBox.minX < $1.boundingBox.minX
            }
            let text = observations
                .compactMap { $0.topCandidates(1).first?.string }
                .joined(separator: " ")
                .replacingOccurrences(of: "\t", with: " ")
                .replacingOccurrences(of: "\n", with: " ")
            print("\(file.lastPathComponent)\t\(text)")
        } catch {
            print("\(file.lastPathComponent)\t")
        }
    }
}
