import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Palette (soma-style)
private let TEAL = Color(red: 0x77/255, green: 0xc8/255, blue: 0xd1/255)
private let BASE = Color(red: 0x0a/255, green: 0x17/255, blue: 0x20/255)
private let SURFACE = Color(red: 0x12/255, green: 0x20/255, blue: 0x2e/255)
private let MUTED = Color(red: 0x5a/255, green: 0x7a/255, blue: 0x8a/255)
private let WARM = Color(red: 0xb1/255, green: 0x78/255, blue: 0x50/255)
private let LIME = Color(red: 0xcb/255, green: 0xe8/255, blue: 0x96/255)
private let INDIGO = Color(red: 0x63/255, green: 0x66/255, blue: 0xb0/255)

private func ymd(_ date: Date = Date()) -> String {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = .current
    return f.string(from: date)
}

/// The meal slot for the current time of day (matches soma's slots).
private func currentSlot() -> String {
    let h = Calendar.current.component(.hour, from: Date())
    switch h {
    case ..<11: return "breakfast"
    case 11..<16: return "lunch"
    case 16..<21: return "dinner"
    default: return "pre_sleep"
    }
}
private func slotLabel(_ s: String) -> String {
    s.replacingOccurrences(of: "_", with: " ").uppercased()
}

// MARK: - App Intent: log a preset meal with one tap (no app open)
struct LogPresetIntent: AppIntent {
    static var title: LocalizedStringResource = "Log preset meal"
    static var isDiscoverable = false

    @Parameter(title: "Preset ID") var presetId: String
    @Parameter(title: "Slot") var mealSlot: String
    @Parameter(title: "Calories") var calories: Double
    @Parameter(title: "Protein") var protein: Double
    @Parameter(title: "Carbs") var carbs: Double
    @Parameter(title: "Fat") var fat: Double
    @Parameter(title: "Fiber") var fiber: Double

    init() {}
    init(preset: NutritionPreset, slot: String) {
        presetId = preset.id; mealSlot = slot
        calories = preset.calories; protein = preset.protein
        carbs = preset.carbs; fat = preset.fat; fiber = preset.fiber
    }

    func perform() async throws -> some IntentResult {
        var req = URLRequest(url: URL(string: SOMA_WIDGET_API + "/api/nutrition/log-meal")!)
        req.httpMethod = "POST"
        req.setValue("Bearer " + SOMA_WIDGET_TOKEN, forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "date": ymd(), "meal_slot": mealSlot, "preset_meal_id": presetId,
            "source": "widget", "items": [],
            "preset_macros": ["calories": calories, "protein": protein, "carbs": carbs, "fat": fat, "fiber": fiber],
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        _ = try? await URLSession.shared.data(for: req)
        WidgetCenter.shared.reloadTimelines(ofKind: "SomaNutrition")
        return .result()
    }
}

// MARK: - Model
struct NutritionPreset: Identifiable {
    let id: String, name: String, slot: String
    let calories: Double, protein: Double, carbs: Double, fat: Double, fiber: Double
}
struct NutritionEntry: TimelineEntry {
    let date: Date
    var eaten: Int = 0
    var target: Int = 0
    var remaining: Int = 0
    var hasPlan: Bool = false
    var protein: Int = 0, carbs: Int = 0, fat: Int = 0
    var slot: String = "lunch"
    var presets: [NutritionPreset] = []
}

// MARK: - Networking
private func authed(_ path: String) -> URLRequest {
    var r = URLRequest(url: URL(string: SOMA_WIDGET_API + path)!)
    r.setValue("Bearer " + SOMA_WIDGET_TOKEN, forHTTPHeaderField: "Authorization")
    r.cachePolicy = .reloadIgnoringLocalCacheData
    r.timeoutInterval = 15
    return r
}
private func num(_ v: Any?) -> Double {
    (v as? Double) ?? Double(v as? Int ?? 0)
}

private func fetchNutrition() async -> NutritionEntry {
    var e = NutritionEntry(date: Date())
    e.slot = currentSlot()
    // plan (eaten / remaining / macros)
    if let (d, _) = try? await URLSession.shared.data(for: authed("/api/nutrition/plan?date=\(ymd())")),
       let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
        let consumed = j["consumed"] as? [String: Any]
        e.eaten = Int(num(consumed?["calories"]))
        e.protein = Int(num(consumed?["protein"]))
        e.carbs = Int(num(consumed?["carbs"]))
        e.fat = Int(num(consumed?["fat"]))
        if let plan = j["plan"] as? [String: Any], let t = plan["target_calories"] {
            e.target = Int(num(t)); e.hasPlan = true
        }
        if let rem = j["remaining"] as? [String: Any], let rc = rem["calories"] {
            e.remaining = Int(num(rc))
        } else if e.hasPlan {
            e.remaining = e.target - e.eaten
        }
    }
    // presets for the current slot (fallback to any if none for the slot)
    if let (d, _) = try? await URLSession.shared.data(for: authed("/api/nutrition/presets")),
       let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
       let arr = j["presets"] as? [[String: Any]] {
        let all = arr.map { p in
            NutritionPreset(
                id: "\(p["id"] ?? "")", name: (p["name"] as? String) ?? "Meal",
                slot: (p["meal_slot"] as? String) ?? "",
                calories: num(p["total_calories"]), protein: num(p["total_protein"]),
                carbs: num(p["total_carbs"]), fat: num(p["total_fat"]), fiber: num(p["total_fiber"]))
        }
        let forSlot = all.filter { $0.slot == e.slot }
        e.presets = (forSlot.isEmpty ? all : forSlot).sorted { $0.calories < $1.calories }
    }
    return e
}

// MARK: - Timeline
struct NutritionProvider: TimelineProvider {
    func placeholder(in c: Context) -> NutritionEntry { sample() }
    func getSnapshot(in c: Context, completion: @escaping (NutritionEntry) -> Void) {
        Task { completion(await fetchNutrition()) }
    }
    func getTimeline(in c: Context, completion: @escaping (Timeline<NutritionEntry>) -> Void) {
        Task {
            let e = await fetchNutrition()
            let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date())!
            completion(Timeline(entries: [e], policy: .after(next)))
        }
    }
    private func sample() -> NutritionEntry {
        var e = NutritionEntry(date: Date(), eaten: 430, target: 1563, remaining: 1133, hasPlan: true, protein: 32, carbs: 40, fat: 12, slot: "lunch")
        e.presets = [
            NutritionPreset(id: "1", name: "Chicken, Sweet Potato, Cottage", slot: "lunch", calories: 443, protein: 45, carbs: 38, fat: 10, fiber: 8),
            NutritionPreset(id: "2", name: "Energy Gel", slot: "lunch", calories: 100, protein: 0, carbs: 25, fat: 0, fiber: 0),
        ]
        return e
    }
}

// MARK: - Views
private struct PresetButton: View {
    let preset: NutritionPreset
    let slot: String
    var compact: Bool = false
    var body: some View {
        Button(intent: LogPresetIntent(preset: preset, slot: slot)) {
            HStack(spacing: 6) {
                Image(systemName: "plus.circle.fill").font(.system(size: compact ? 13 : 15)).foregroundStyle(TEAL)
                Text(preset.name).font(.system(size: compact ? 11 : 12, weight: .semibold)).foregroundStyle(.white)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text("\(Int(preset.calories))").font(.system(size: compact ? 11 : 12, weight: .bold, design: .rounded)).foregroundStyle(MUTED)
            }
            .padding(.horizontal, 9).padding(.vertical, compact ? 6 : 7)
            .background(SURFACE).clipShape(RoundedRectangle(cornerRadius: 9))
        }
        .buttonStyle(.plain)
    }
}

struct NutritionWidgetView: View {
    var entry: NutritionEntry
    @Environment(\.widgetFamily) var family

    private var headline: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            if entry.hasPlan {
                Text("\(entry.remaining)").font(.system(size: 30, weight: .bold, design: .rounded)).foregroundStyle(.white)
                Text("kcal left").font(.system(size: 11, weight: .semibold)).foregroundStyle(MUTED)
            } else {
                Text("\(entry.eaten)").font(.system(size: 30, weight: .bold, design: .rounded)).foregroundStyle(.white)
                Text("kcal eaten").font(.system(size: 11, weight: .semibold)).foregroundStyle(MUTED)
            }
        }
    }
    private var header: some View {
        HStack(spacing: 5) {
            Text("SOMA").font(.system(size: 10, weight: .heavy)).foregroundStyle(TEAL).tracking(1.4)
            Text("· \(slotLabel(entry.slot))").font(.system(size: 9, weight: .bold)).foregroundStyle(MUTED)
            Spacer()
        }
    }

    var body: some View {
        switch family {
        case .systemSmall:
            VStack(alignment: .leading, spacing: 6) {
                header; headline; Spacer(minLength: 0)
                if let p = entry.presets.first { PresetButton(preset: p, slot: entry.slot, compact: true) }
            }.padding(12).containerBackground(BASE, for: .widget)
        case .systemLarge:
            VStack(alignment: .leading, spacing: 8) {
                header; headline
                HStack(spacing: 14) {
                    macro("P", entry.protein, WARM); macro("C", entry.carbs, INDIGO); macro("F", entry.fat, LIME)
                }
                Text("QUICK-LOG \(slotLabel(entry.slot))").font(.system(size: 9, weight: .bold)).foregroundStyle(MUTED).padding(.top, 2)
                VStack(spacing: 6) { ForEach(entry.presets.prefix(5)) { PresetButton(preset: $0, slot: entry.slot) } }
                Spacer(minLength: 0)
            }.padding(14).containerBackground(BASE, for: .widget)
        default: // medium
            VStack(alignment: .leading, spacing: 7) {
                header; headline
                VStack(spacing: 6) { ForEach(entry.presets.prefix(3)) { PresetButton(preset: $0, slot: entry.slot) } }
                Spacer(minLength: 0)
            }.padding(13).containerBackground(BASE, for: .widget)
        }
    }
    private func macro(_ l: String, _ v: Int, _ c: Color) -> some View {
        HStack(spacing: 3) {
            Text("\(v)").font(.system(size: 14, weight: .bold, design: .rounded)).foregroundStyle(c)
            Text(l).font(.system(size: 9, weight: .semibold)).foregroundStyle(MUTED)
        }
    }
}

struct nutritionWidget: Widget {
    let kind = "SomaNutrition"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NutritionProvider()) { entry in
            NutritionWidgetView(entry: entry)
        }
        .configurationDisplayName("Soma Nutrition")
        .description("Calories + one-tap meal logging from your presets.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
