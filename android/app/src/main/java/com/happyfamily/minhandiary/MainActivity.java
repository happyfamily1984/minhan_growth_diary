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
        // 폰 글꼴 크기를 아주 크게 해 두어도 화면이 깨지지 않도록 최대 115% 까지만 키운다
        android.webkit.WebSettings ws = getBridge().getWebView().getSettings();
        if (ws.getTextZoom() > 115) ws.setTextZoom(115);
        handleShare(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
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

    private static class ShareBridge {
        @JavascriptInterface
        public String take() {
            String p = pending;
            pending = null;
            return p;
        }
    }
}
