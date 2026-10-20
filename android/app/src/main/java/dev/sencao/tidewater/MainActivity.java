package dev.sencao.tidewater;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/game/index.html?mobile=1";
    private WebView webView;
    private boolean rendererGone = false;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setDecorFitsSystemWindows(false);
        createWebView();
        hideSystemBars();
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void createWebView() {
        rendererGone = false;
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(9, 29, 41));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        boolean debug = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debug);
        webView.addJavascriptInterface(new ReportBridge(), "TidewaterHost");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && HOST.equals(uri.getHost())) {
                    WebResourceResponse response = loader.shouldInterceptRequest(uri);
                    if (response != null) return response;
                    return blocked("Local resource not found: " + uri.getPath(), 404);
                }
                if ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) {
                    return blocked("Network resources are disabled in this offline build.", 403);
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !("https".equals(uri.getScheme()) && HOST.equals(uri.getHost()));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (url.startsWith("https://" + HOST + "/")) {
                    view.evaluateJavascript("window.__ANDROID_ENV__ = " + environmentJson() + ";", null);
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                rendererGone = true;
                webView = null;
                view.destroy();
                showNativeError("网页渲染进程已停止。可能是内存不足或图形驱动错误。重启后可先选择较低渲染精细度。");
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                if (debug) android.util.Log.d("Tidewater", message.message());
                return true;
            }
        });
        setContentView(webView);
        webView.loadUrl(START_URL);
    }

    private WebResourceResponse blocked(String message, int status) {
        return new WebResourceResponse(
                "text/plain", "utf-8", status, status == 404 ? "Not Found" : "Forbidden",
                Collections.emptyMap(),
                new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8)));
    }

    private String environmentJson() {
        JSONObject info = new JSONObject();
        try {
            info.put("manufacturer", Build.MANUFACTURER);
            info.put("model", Build.MODEL);
            info.put("androidRelease", Build.VERSION.RELEASE);
            info.put("api", Build.VERSION.SDK_INT);
            PackageInfo provider = WebView.getCurrentWebViewPackage();
            if (provider != null) {
                info.put("webViewPackage", provider.packageName);
                info.put("webViewVersion", provider.versionName);
            }
        } catch (JSONException ignored) {
            return "{}";
        }
        return info.toString();
    }

    private void hideSystemBars() {
        WindowInsetsController controller = getWindow().getInsetsController();
        if (controller != null) {
            controller.hide(WindowInsets.Type.systemBars());
            controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) hideSystemBars();
    }

    @Override
    protected void onPause() {
        if (webView != null && !rendererGone) {
            webView.evaluateJavascript(
                    "window.dispatchEvent(new Event('tidewater:pause'));", null);
            webView.onPause();
            webView.pauseTimers();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null && !rendererGone) {
            webView.resumeTimers();
            webView.onResume();
            webView.evaluateJavascript(
                    "window.dispatchEvent(new Event('tidewater:resume'));", null);
        }
        hideSystemBars();
    }

    @Override
    public void onBackPressed() {
        if (webView == null || rendererGone) {
            finish();
            return;
        }
        webView.evaluateJavascript(
                "window.__tideHandleBack ? window.__tideHandleBack() : false;",
                handled -> {
                    if ("true".equals(handled)) return;
                    new AlertDialog.Builder(this)
                            .setMessage("退出 Tidewater？游戏进度保存在本机。")
                            .setNegativeButton("继续游戏", null)
                            .setPositiveButton("退出", (dialog, which) -> finish())
                            .show();
                });
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("TidewaterHost");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void showNativeError(String message) {
        runOnUiThread(() -> {
            LinearLayout layout = new LinearLayout(this);
            layout.setOrientation(LinearLayout.VERTICAL);
            layout.setBackgroundColor(Color.rgb(9, 29, 41));
            int padding = (int) (24 * getResources().getDisplayMetrics().density);
            layout.setPadding(padding, padding, padding, padding);
            TextView text = new TextView(this);
            text.setTextColor(Color.WHITE);
            text.setTextSize(18);
            text.setText(message);
            layout.addView(text);
            Button retry = new Button(this);
            retry.setText("重新启动");
            retry.setOnClickListener(v -> {
                createWebView();
                webView.resumeTimers();
                hideSystemBars();
            });
            layout.addView(retry);
            setContentView(layout);
        });
    }

    private class ReportBridge {
        @JavascriptInterface
        public void copyReport(String text) {
            if (text == null || text.length() > 200000) return;
            runOnUiThread(() -> {
                ClipboardManager clipboard = getSystemService(ClipboardManager.class);
                if (clipboard != null) {
                    clipboard.setPrimaryClip(ClipData.newPlainText("Tidewater 运行诊断", text));
                    Toast.makeText(MainActivity.this, "诊断信息已复制", Toast.LENGTH_SHORT).show();
                }
            });
        }
    }
}
