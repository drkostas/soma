package dev.gkos.soma.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import dev.gkos.soma.R
import org.json.JSONArray
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * "Soma Nutrition" home-screen widget: calories remaining/eaten + one-tap quick-log
 * of preset meals for the current slot. Parity with the iOS widget (NutritionWidget.swift):
 * tapping a preset POSTs /api/nutrition/log-meal and refreshes, no app open needed.
 */
class SomaNutritionWidget : AppWidgetProvider() {

    companion object {
        const val ACTION_LOG = "dev.gkos.soma.widget.ACTION_LOG"
        const val EX_ID = "preset_id"
        const val EX_SLOT = "slot"
        const val EX_CAL = "calories"
        const val EX_P = "protein"
        const val EX_C = "carbs"
        const val EX_F = "fat"
        const val EX_FIB = "fiber"
    }

    private data class Preset(
        val id: String,
        val name: String,
        val slot: String,
        val calories: Double,
        val protein: Double,
        val carbs: Double,
        val fat: Double,
        val fiber: Double
    )

    private data class Nutri(
        val slot: String,
        val eaten: Int,
        val target: Int,
        val remaining: Int,
        val hasPlan: Boolean,
        val presets: List<Preset>
    )

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_LOG) {
            val result = goAsync()
            thread {
                try {
                    logPreset(intent)
                    updateAll(context)
                } catch (_: Throwable) {
                } finally {
                    result.finish()
                }
            }
            return
        }
        super.onReceive(context, intent)
    }

    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        val result = goAsync()
        thread {
            try {
                val e = fetch()
                for (id in ids) mgr.updateAppWidget(id, render(context, e))
            } catch (_: Throwable) {
            } finally {
                result.finish()
            }
        }
    }

    private fun updateAll(context: Context) {
        val mgr = AppWidgetManager.getInstance(context)
        val ids = mgr.getAppWidgetIds(ComponentName(context, SomaNutritionWidget::class.java))
        val e = fetch()
        for (id in ids) mgr.updateAppWidget(id, render(context, e))
    }

    private fun logPreset(intent: Intent) {
        val body = JSONObject()
        body.put("date", ymd())
        body.put("meal_slot", intent.getStringExtra(EX_SLOT) ?: currentSlot())
        body.put("preset_meal_id", intent.getStringExtra(EX_ID) ?: "")
        body.put("source", "widget")
        body.put("items", JSONArray())
        val macros = JSONObject()
        macros.put("calories", intent.getDoubleExtra(EX_CAL, 0.0))
        macros.put("protein", intent.getDoubleExtra(EX_P, 0.0))
        macros.put("carbs", intent.getDoubleExtra(EX_C, 0.0))
        macros.put("fat", intent.getDoubleExtra(EX_F, 0.0))
        macros.put("fiber", intent.getDoubleExtra(EX_FIB, 0.0))
        body.put("preset_macros", macros)
        Net.post("/api/nutrition/log-meal", body)
    }

    private fun fetch(): Nutri {
        val slot = currentSlot()
        var eaten = 0
        var target = 0
        var remaining = 0
        var hasPlan = false
        val plan = Net.get("/api/nutrition/plan?date=" + ymd())
        if (plan != null) {
            val consumed = plan.optJSONObject("consumed")
            eaten = jInt(consumed, "calories")
            val p = plan.optJSONObject("plan")
            if (p != null && p.has("target_calories")) {
                target = p.optDouble("target_calories", 0.0).toInt()
                hasPlan = true
            }
            val rem = plan.optJSONObject("remaining")
            remaining = when {
                rem != null && rem.has("calories") -> rem.optDouble("calories", 0.0).toInt()
                hasPlan -> target - eaten
                else -> 0
            }
        }

        val presets = ArrayList<Preset>()
        val arr: JSONArray? = Net.get("/api/nutrition/presets")?.optJSONArray("presets")
        if (arr != null) {
            val all = ArrayList<Preset>()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                all.add(
                    Preset(
                        id = o.opt("id")?.toString() ?: "",
                        name = o.optString("name", "Meal"),
                        slot = o.optString("meal_slot", ""),
                        calories = o.optDouble("total_calories", 0.0),
                        protein = o.optDouble("total_protein", 0.0),
                        carbs = o.optDouble("total_carbs", 0.0),
                        fat = o.optDouble("total_fat", 0.0),
                        fiber = o.optDouble("total_fiber", 0.0)
                    )
                )
            }
            val forSlot = all.filter { it.slot == slot }
            val chosen = if (forSlot.isEmpty()) all else forSlot
            presets.addAll(chosen.sortedBy { it.calories })
        }
        return Nutri(slot, eaten, target, remaining, hasPlan, presets)
    }

    /**
     * Responsive: a compact 2x2 layout (headline + 1 quick-log preset) when small,
     * the full layout (up to 3 presets) when taller. Android 12+ picks the largest
     * mapped layout that fits; below that we fall back to the full layout.
     */
    private fun render(context: Context, e: Nutri): RemoteViews {
        val full = bind(context, R.layout.soma_nutrition, e, 3)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val small = bind(context, R.layout.soma_nutrition_small, e, 1)
            return RemoteViews(
                mapOf(
                    SizeF(120f, 120f) to small,
                    SizeF(220f, 170f) to full
                )
            )
        }
        return full
    }

    /** Binds the headline + up to maxPresets quick-log rows (small layout has only preset_0). */
    private fun bind(context: Context, layoutId: Int, e: Nutri, maxPresets: Int): RemoteViews {
        val rv = RemoteViews(context.packageName, layoutId)
        rv.setTextViewText(R.id.slot, " · " + slotLabel(e.slot))
        if (e.hasPlan) {
            rv.setTextViewText(R.id.kcal_value, e.remaining.toString())
            rv.setTextViewText(R.id.kcal_label, " kcal left")
        } else {
            rv.setTextViewText(R.id.kcal_value, e.eaten.toString())
            rv.setTextViewText(R.id.kcal_label, " kcal eaten")
        }
        val rows = intArrayOf(R.id.preset_0, R.id.preset_1, R.id.preset_2)
        val names = intArrayOf(R.id.preset_0_name, R.id.preset_1_name, R.id.preset_2_name)
        val kcals = intArrayOf(R.id.preset_0_kcal, R.id.preset_1_kcal, R.id.preset_2_kcal)
        for (i in 0 until maxPresets) {
            val p = e.presets.getOrNull(i)
            if (p == null) {
                rv.setViewVisibility(rows[i], View.GONE)
            } else {
                rv.setViewVisibility(rows[i], View.VISIBLE)
                rv.setTextViewText(names[i], p.name)
                rv.setTextViewText(kcals[i], p.calories.toInt().toString())
                rv.setOnClickPendingIntent(rows[i], logIntent(context, i, p, e.slot))
            }
        }
        openApp(context)?.let { rv.setOnClickPendingIntent(R.id.root, it) }
        return rv
    }

    private fun logIntent(context: Context, index: Int, p: Preset, slot: String): PendingIntent {
        val i = Intent(context, SomaNutritionWidget::class.java).apply {
            action = ACTION_LOG
            putExtra(EX_ID, p.id)
            putExtra(EX_SLOT, slot)
            putExtra(EX_CAL, p.calories)
            putExtra(EX_P, p.protein)
            putExtra(EX_C, p.carbs)
            putExtra(EX_F, p.fat)
            putExtra(EX_FIB, p.fiber)
        }
        return PendingIntent.getBroadcast(
            context, 100 + index, i,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
    }

    private fun openApp(context: Context): PendingIntent? {
        val i = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
        return PendingIntent.getActivity(
            context, 0, i,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
    }
}
