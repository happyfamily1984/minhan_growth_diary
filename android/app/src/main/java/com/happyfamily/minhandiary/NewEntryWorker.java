package com.happyfamily.minhandiary;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

/**
 * 앱이 꺼져 있어도 15분마다 클라우드(Firestore)에서 다른 사람이 새로 쓴 글을 찾아 알림을 띄운다.
 * - 1개: "새 내용이 1월 6일자로 올라왔어요" + 내용 미리보기
 * - 여러 개: 하나로 합쳐 "새 내용이 3개 작성되었어요"
 * - 누르면 가장 먼저 쓰인 새 글로 이동 (MainActivity 가 웹 화면에 전달)
 */
public class NewEntryWorker extends Worker {
    static final String PREFS = "minhan-notify";
    static final String CHANNEL = "new_entries";
    static final int NOTIF_ID = 1001;
    static final String EXTRA_OPEN = "openEntry";
    static final int AI_NOTIF_ID = 1002; // 월별 AI 분석 도착

    // www/firebase-config.js 와 같은 값
    private static final String API_KEY = "AIzaSyASJgfGdlxzfGPm9mmwqMtu_c7NF0iiwfk";
    private static final String PROJECT = "minhan-diary";
    private static final String FAMILY = "happyfamily";

    public NewEntryWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    /** 15분마다 확인하도록 등록 (이미 있으면 그대로) */
    static void schedule(Context ctx) {
        Constraints c = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(NewEntryWorker.class, 15, TimeUnit.MINUTES)
            .setConstraints(c)
            .build();
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("new-entries", ExistingPeriodicWorkPolicy.KEEP, req);
    }

    /** 지금 한 번 확인 (시험용) */
    static void checkNow(Context ctx) {
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(NewEntryWorker.class).build();
        WorkManager.getInstance(ctx).enqueueUniqueWork("new-entries-now", ExistingWorkPolicy.REPLACE, req);
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "새 글 알림", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("가족이 민한이 기록을 새로 쓰면 알려 줘요");
            ctx.getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        p.edit().putString("lastRun", now()).apply();
        String refresh = p.getString("refreshToken", "");
        if (refresh.isEmpty()) {
            p.edit().putString("lastResult", "로그인 정보가 아직 없어요 (앱을 한 번 열어 주세요)").apply();
            return Result.success(); // 아직 로그인 전
        }
        try {
            // 1) 로그인 토큰 받기
            String form = "grant_type=refresh_token&refresh_token=" + URLEncoder.encode(refresh, "UTF-8");
            JSONObject tok = new JSONObject(http("https://securetoken.googleapis.com/v1/token?key=" + API_KEY,
                "application/x-www-form-urlencoded", form, null));
            String idToken = tok.getString("id_token");
            if (tok.has("refresh_token")) p.edit().putString("refreshToken", tok.getString("refresh_token")).apply();

            // 2) 마지막으로 확인한 뒤에 쓰인 글 찾기
            String since = max(p.getString("since", ""), max(p.getString("appSeen", ""), p.getString("lastNotified", "")));
            JSONObject q = new JSONObject()
                .put("structuredQuery", new JSONObject()
                    .put("from", new JSONArray().put(new JSONObject().put("collectionId", "entries")))
                    .put("where", new JSONObject().put("fieldFilter", new JSONObject()
                        .put("field", new JSONObject().put("fieldPath", "createdAt"))
                        .put("op", "GREATER_THAN")
                        .put("value", new JSONObject().put("stringValue", since))))
                    .put("orderBy", new JSONArray().put(new JSONObject()
                        .put("field", new JSONObject().put("fieldPath", "createdAt")).put("direction", "ASCENDING")))
                    .put("limit", 50));
            String url = "https://firestore.googleapis.com/v1/projects/" + PROJECT
                + "/databases/(default)/documents/families/" + FAMILY + ":runQuery";
            JSONArray rows = new JSONArray(http(url, "application/json", q.toString(), idToken));

            String me = p.getString("author", "");
            JSONArray pending = new JSONArray(p.getString("pending", "[]"));
            String lastNotified = p.getString("lastNotified", "");
            int added = 0;
            for (int i = 0; i < rows.length(); i++) {
                JSONObject doc = rows.getJSONObject(i).optJSONObject("document");
                if (doc == null) continue;
                JSONObject f = doc.getJSONObject("fields");
                String author = str(f, "author");
                String createdAt = str(f, "createdAt");
                lastNotified = max(lastNotified, createdAt);
                if (author.isEmpty() || author.equals(me)) continue; // 내가 쓴 글은 알리지 않음
                pending.put(new JSONObject()
                    .put("id", str(f, "id"))
                    .put("date", str(f, "date"))
                    .put("text", str(f, "text"))
                    .put("author", author));
                added++;
            }
            p.edit().putString("pending", pending.toString()).putString("lastNotified", lastNotified)
                .putString("lastResult", "확인 완료 · 새 글 " + added + "개 (찾은 글 " + rows.length() + "개)")
                .remove("lastError").apply();
            if (added > 0) show(ctx, pending);
            checkAnalyses(ctx, p, url, idToken, me);
            return Result.success();
        } catch (Exception e) {
            p.edit().putString("lastError", now() + " " + e).apply();
            return Result.retry();
        }
    }

    /** 알림 띄우기: 여러 개면 하나로 합침. 누르면 가장 먼저 쓰인 글로 */
    static void show(Context ctx, JSONArray pending) throws Exception {
        if (pending.length() == 0) return;
        ensureChannel(ctx);
        JSONObject first = pending.getJSONObject(0);
        String title;
        String body;
        if (pending.length() == 1) {
            title = "새 내용이 " + koDate(first.getString("date")) + "자로 올라왔어요";
            body = first.optString("author") + ": " + first.optString("text");
        } else {
            title = "새 내용이 " + pending.length() + "개 작성되었어요";
            body = "눌러서 먼저 쓰인 것부터 볼 수 있어요";
        }
        Intent open = new Intent(ctx, MainActivity.class)
            .putExtra(EXTRA_OPEN, first.getString("id"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_note)
            .setColor(0xFFF57A2E)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setNumber(pending.length())
            .setContentIntent(pi)
            .setAutoCancel(true);
        try {
            NotificationManagerCompat.from(ctx).notify(NOTIF_ID, b.build());
        } catch (SecurityException ignored) {
            // 알림 권한을 허용하지 않은 경우
        }
    }

    /** 다른 폰에서 의뢰한 월별 AI 분석이 끝났으면 알림 */
    private static void checkAnalyses(Context ctx, SharedPreferences p, String url, String idToken, String me) {
        try {
            String since = max(p.getString("aiSince", ""), max(p.getString("aiSeen", ""), p.getString("aiNotified", "")));
            JSONObject q = new JSONObject()
                .put("structuredQuery", new JSONObject()
                    .put("from", new JSONArray().put(new JSONObject().put("collectionId", "analyses")))
                    .put("where", new JSONObject().put("fieldFilter", new JSONObject()
                        .put("field", new JSONObject().put("fieldPath", "doneAt"))
                        .put("op", "GREATER_THAN")
                        .put("value", new JSONObject().put("stringValue", since))))
                    .put("orderBy", new JSONArray().put(new JSONObject()
                        .put("field", new JSONObject().put("fieldPath", "doneAt")).put("direction", "DESCENDING")))
                    .put("limit", 10));
            JSONArray rows = new JSONArray(http(url, "application/json", q.toString(), idToken));
            String last = p.getString("aiNotified", "");
            JSONObject newest = null;
            for (int i = 0; i < rows.length(); i++) {
                JSONObject doc = rows.getJSONObject(i).optJSONObject("document");
                if (doc == null) continue;
                JSONObject f = doc.getJSONObject("fields");
                String doneAt = str(f, "doneAt");
                last = max(last, doneAt);
                if (!"done".equals(str(f, "status"))) continue;
                if (str(f, "requestedBy").equals(me)) continue; // 내가 의뢰한 건 그 폰 화면이 알려 줌
                if (newest == null) newest = f;
            }
            p.edit().putString("aiNotified", last).apply();
            if (newest != null) {
                String who = str(newest, "requestedBy");
                if (who.isEmpty()) who = "가족";
                String label = str(newest, "label");
                if (label.isEmpty()) label = str(newest, "month");
                showAnalysis(ctx, str(newest, "month"), who + josa(who) + " 의뢰한 " + label + " AI분석 내용 도착했어요",
                    "눌러서 민한이의 이달 분석을 볼 수 있어요");
            }
        } catch (Exception e) {
            p.edit().putString("lastError", now() + " AI분석 확인: " + e).apply();
        }
    }

    static String josa(String w) {
        if (w.isEmpty()) return "가";
        char c = w.charAt(w.length() - 1);
        if (c < 0xAC00 || c > 0xD7A3) return "가";
        return (c - 0xAC00) % 28 == 0 ? "가" : "이";
    }

    /** 월별 AI 분석 도착 알림. 누르면 그 달 분석 화면으로 */
    static void showAnalysis(Context ctx, String month, String title, String body) {
        ensureChannel(ctx);
        Intent open = new Intent(ctx, MainActivity.class)
            .putExtra(EXTRA_OPEN, "ai:" + month)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 1, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_note)
            .setColor(0xFF7C5CE0)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pi)
            .setAutoCancel(true);
        try {
            NotificationManagerCompat.from(ctx).notify(AI_NOTIF_ID, b.build());
        } catch (SecurityException ignored) {}
    }

    static String now() {
        return new java.text.SimpleDateFormat("M/d HH:mm:ss", java.util.Locale.KOREA).format(new java.util.Date());
    }

    /** 앱이 뒤에 있을 때 웹 화면이 찾은 새 글을 바로 알린다 (15분 기다리지 않고) */
    static void addAndShow(Context ctx, JSONArray items) throws Exception {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray pending = new JSONArray(p.getString("pending", "[]"));
        java.util.HashSet<String> ids = new java.util.HashSet<>();
        for (int i = 0; i < pending.length(); i++) ids.add(pending.getJSONObject(i).optString("id"));
        String last = p.getString("lastNotified", "");
        int added = 0;
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.getJSONObject(i);
            String created = it.optString("createdAt");
            if (ids.contains(it.optString("id")) || created.compareTo(max(last, p.getString("appSeen", ""))) <= 0) continue;
            pending.put(it);
            last = max(last, created);
            added++;
        }
        p.edit().putString("pending", pending.toString()).putString("lastNotified", last).apply();
        if (added > 0) show(ctx, pending);
    }

    private static String koDate(String ymd) {
        try {
            String[] s = ymd.split("-");
            return Integer.parseInt(s[1]) + "월 " + Integer.parseInt(s[2]) + "일";
        } catch (Exception e) {
            return ymd;
        }
    }

    private static String str(JSONObject fields, String key) {
        JSONObject v = fields.optJSONObject(key);
        return v == null ? "" : v.optString("stringValue", "");
    }

    private static String max(String a, String b) {
        return a.compareTo(b) >= 0 ? a : b;
    }

    private static String http(String url, String type, String body, String bearer) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", type);
        if (bearer != null) c.setRequestProperty("Authorization", "Bearer " + bearer);
        try (OutputStream os = c.getOutputStream()) {
            os.write(body.getBytes(StandardCharsets.UTF_8));
        }
        int code = c.getResponseCode();
        InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        while (in != null && (n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
        if (code >= 400) throw new RuntimeException("HTTP " + code + " " + buf.toString("UTF-8"));
        return buf.toString("UTF-8");
    }
}
