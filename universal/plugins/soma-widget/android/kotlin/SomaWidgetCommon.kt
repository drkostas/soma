package dev.gkos.soma.widget

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * Self-contained networking for the home-screen widgets. Mirrors the iOS widget
 * (the Swift sources under targets/widget): each widget fetches its own data from
 * soma's public API with a read-scoped bearer token, so it works even when the
 * app process is dead.
 */
object Net {
    fun get(path: String): JSONObject? {
        return try {
            val c = open(path, "GET")
            val code = c.responseCode
            if (code !in 200..299) {
                c.disconnect()
                return null
            }
            val text = c.inputStream.bufferedReader().use { it.readText() }
            c.disconnect()
            JSONObject(text)
        } catch (e: Throwable) {
            null
        }
    }

    fun post(path: String, body: JSONObject): Int {
        return try {
            val c = open(path, "POST")
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = c.responseCode
            c.disconnect()
            code
        } catch (e: Throwable) {
            -1
        }
    }

    private fun open(path: String, method: String): HttpURLConnection {
        val c = URL(WidgetSecrets.API + path).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.setRequestProperty("Authorization", "Bearer " + WidgetSecrets.TOKEN)
        c.connectTimeout = 15000
        c.readTimeout = 15000
        c.useCaches = false
        return c
    }
}

/** JSON number read that tolerates both int and double encodings (API returns either). */
fun jInt(o: JSONObject?, key: String): Int {
    if (o == null) return 0
    return o.optDouble(key, 0.0).toInt()
}

fun ymd(offsetDays: Int = 0): String {
    val cal = Calendar.getInstance()
    cal.add(Calendar.DAY_OF_YEAR, offsetDays)
    return SimpleDateFormat("yyyy-MM-dd", Locale.US).format(cal.time)
}

/** Meal slot for the current time of day (matches soma's slots + the iOS widget). */
fun currentSlot(): String {
    val h = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    return when {
        h < 11 -> "breakfast"
        h < 16 -> "lunch"
        h < 21 -> "dinner"
        else -> "pre_sleep"
    }
}

fun slotLabel(s: String): String = s.replace("_", " ").uppercase()

fun readinessColor(r: String): Int = when (r) {
    "green" -> 0xFF6AD4A0.toInt()
    "amber", "yellow" -> 0xFFE0A458.toInt()
    "red" -> 0xFFE06060.toInt()
    else -> 0xFF5A7A8A.toInt()
}
