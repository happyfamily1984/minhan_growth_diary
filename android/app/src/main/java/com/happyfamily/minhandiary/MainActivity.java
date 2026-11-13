package com.happyfamily.minhandiary;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Parcelable;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import com.getcapacitor.BridgeActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;

/**
 * 텔레그램 등 다른 앱에서 [공유 → 민한이 성장일기] 로 보낸 글/캡쳐를 받아
 * 웹 화면(app.js)에 넘겨준다. 웹은 AndroidShare.take() 로 가져간다.
 */
public class MainActivity extends BridgeActivity {
    private static String pending = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getBridge().getWebView().addJavascriptInterface(new ShareBridge(), "AndroidShare");
        getBridge().getWebView().addJavascriptInterface(new NotifyBridge(getApplicationContext()), "AndroidNotify");
        handleOpen(getIntent());
        // 새 글 알림: 15분마다 확인 + 알림 권한 물어보기 (안드로이드 13 이상)
        NewEntryWorker.ensureChannel(this);
        NewEntryWorker.schedule(this);
        if (android.os.Build.VERSION.SDK_INT >= 33
            && androidx.core.content.ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            androidx.core.app.ActivityCompat.requestPermissions(this, new String[] { android.Manifest.permission.POST_NOTIFICATIONS }, 7);
        }
        // 폰 글꼴 크기를 아주 크게 해 두어도 화면이 깨지지 않도록 최대 115% 까지만 키운다
        android.webkit.WebSettings ws = getBridge().getWebView().getSettings();
        if (ws.getTextZoom() > 115) ws.setTextZoom(115);
        handleShare(getIntent());
    }

    @Override
    public void onResume() {
        super.onResume();
        // 앱을 열면 쌓인 알림은 지운다 (앱 안에서 N 으로 보임)
        androidx.core.app.NotificationManagerCompat.from(this).cancel(NewEntryWorker.NOTIF_ID);
        getSharedPreferences(NewEntryWorker.PREFS, MODE_PRIVATE).edit().remove("pending").apply();
    }

    private static String pendingOpen = null;

    /** 알림을 눌러서 열렸으면 열어 줄 글을 기억해 둔다 */
    private void handleOpen(Intent intent) {
        if (intent == null) return;
        String id = intent.getStringExtra(NewEntryWorker.EXTRA_OPEN);
        if (id != null) {
            pendingOpen = id;
            intent.removeExtra(NewEntryWorker.EXTRA_OPEN);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleOpen(intent);
        getBridge().getWebView().post(() ->
            getBridge().getWebView().evaluateJavascript("window.onAndroidOpen && window.onAndroidOpen()", null));
        handleShare(intent);
        getBridge().getWebView().post(() ->
            getBridge().getWebView().evaluateJavascript("window.onAndroidShare && window.onAndroidShare()", null));
    }

    private void handleShare(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;
        try {
            JSONObject out = new JSONObject();
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (text != null) out.put("text", text);
            ArrayList<Uri> uris = new ArrayList<>();
            if (Intent.ACTION_SEND.equals(action)) {
                Parcelable p = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (p instanceof Uri) uris.add((Uri) p);
            } else {
                ArrayList<Parcelable> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (list != null) for (Parcelable p : list) if (p instanceof Uri) uris.add((Uri) p);
            }
            JSONArray images = new JSONArray();
            for (Uri uri : uris) {
                String type = getContentResolver().getType(uri);
                if (type == null || !type.startsWith("image/")) continue;
                try (InputStream in = getContentResolver().openInputStream(uri)) {
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    byte[] chunk = new byte[65536];
                    int n;
                    while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
                    images.put("data:" + type + ";base64," + Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP));
                }
            }
            out.put("images", images);
            pending = out.toString();
        } catch (Exception e) {
            pending = null;
        }
        intent.setAction(null); // 화면 회전 등으로 다시 받지 않게
    }

    /** 웹 화면(app.js)과 알림 설정을 주고받는다 */
    private static class NotifyBridge {
        private final android.content.Context ctx;

        NotifyBridge(android.content.Context ctx) {
            this.ctx = ctx;
        }

        @JavascriptInterface
        public void configure(String json) {
            try {
                JSONObject o = new JSONObject(json);
                android.content.SharedPreferences p = ctx.getSharedPreferences(NewEntryWorker.PREFS, android.content.Context.MODE_PRIVATE);
                android.content.SharedPreferences.Editor e = p.edit();
                if (!o.optString("refreshToken").isEmpty()) e.putString("refreshToken", o.optString("refreshToken"));
                e.putString("author", o.optString("author"));
                if (!p.contains("since")) e.putString("since", o.optString("since")); // 처음 설정한 때부터만 알림
                e.apply();
            } catch (Exception ignored) {}
        }

        /** 앱에서 이미 본 글(이때까지 쓰인 글)은 알리지 않는다 */
        @JavascriptInterface
        public void seenUpTo(String iso) {
            android.content.SharedPreferences p = ctx.getSharedPreferences(NewEntryWorker.PREFS, android.content.Context.MODE_PRIVATE);
            if (iso != null && iso.compareTo(p.getString("appSeen", "")) > 0) p.edit().putString("appSeen", iso).apply();
        }

        @JavascriptInterface
        public String takeOpen() {
            String id = pendingOpen;
            pendingOpen = null;
            return id;
        }

        @JavascriptInterface
        public void checkNow() {
            NewEntryWorker.checkNow(ctx);
        }
    }

    private static class ShareBridge {
        @JavascriptInterface
        public String take() {
            String p = pending;
            pending = null;
            return p;
        }
    }
}
