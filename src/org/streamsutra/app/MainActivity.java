package org.streamsutra.app;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.ClipboardManager;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.util.Rational;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class MainActivity extends Activity {

    private WebView mWebView;
    private FrameLayout mCustomViewContainer;
    private View mCustomView;
    private WebChromeClient.CustomViewCallback mCustomViewCallback;
    private ValueCallback<Uri[]> mFilePathCallback;
    private final static int FILE_CHOOSER_REQUEST_CODE = 1001;
    private long mLastBackTime = 0;
    private boolean mIsInPiP = false;

    // =========================================================================
    // PERSISTENT LOGGER SYSTEM FOR TROUBLESHOOTING
    // =========================================================================
    public static class AppLogger {
        private static File internalLogFile = null;
        private static File publicLogFile = null;
        private static final SimpleDateFormat SDF = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US);

        public static void init(Context ctx) {
            try {
                File filesDir = ctx.getFilesDir();
                if (filesDir != null) {
                    internalLogFile = new File(filesDir, "streamsutra_debug.log");
                }
                File extDir = ctx.getExternalFilesDir(null);
                if (extDir != null) {
                    publicLogFile = new File(extDir, "streamsutra_debug.log");
                } else {
                    publicLogFile = new File("/sdcard/Download/streamsutra_debug.log");
                }
                log("Logger", "=== StreamSutra Logging Initialized (PID: " + android.os.Process.myPid() + ") ===");
            } catch (Exception e) {
                Log.e("StreamSutra", "Logger init error: " + e.getMessage());
            }
        }

        public static synchronized void log(String tag, String msg) {
            String time = SDF.format(new Date());
            String line = String.format("[%s] [%s] %s\n", time, tag, msg);
            Log.i("StreamSutra/" + tag, msg);

            // Write to app internal log file
            writeToFile(internalLogFile, line);
            // Also write to external log file
            writeToFile(publicLogFile, line);
            // Direct write to /sdcard/Download/streamsutra_debug.log if accessible
            try {
                File dlLog = new File("/sdcard/Download/streamsutra_debug.log");
                writeToFile(dlLog, line);
            } catch (Exception ignored) {}
        }

        private static void writeToFile(File file, String line) {
            if (file == null) return;
            try {
                if (file.exists() && file.length() > 1024 * 1024) { // Rotate at 1MB
                    File oldFile = new File(file.getParent(), file.getName() + ".old");
                    file.renameTo(oldFile);
                }
                FileWriter fw = new FileWriter(file, true);
                fw.write(line);
                fw.close();
            } catch (Exception ignored) {}
        }

        public static synchronized String getRecentLogs(int maxLines) {
            File target = (internalLogFile != null && internalLogFile.exists()) ? internalLogFile : publicLogFile;
            if (target == null || !target.exists()) return "No logs generated yet.";

            try {
                List<String> list = new ArrayList<>();
                BufferedReader br = new BufferedReader(new FileReader(target));
                String l;
                while ((l = br.readLine()) != null) {
                    list.add(l);
                    if (list.size() > maxLines) {
                        list.remove(0);
                    }
                }
                br.close();
                StringBuilder sb = new StringBuilder();
                for (String line : list) {
                    sb.append(line).append("\n");
                }
                return sb.toString();
            } catch (Exception e) {
                return "Error reading log file: " + e.getMessage();
            }
        }

        public static synchronized void clearLogs() {
            try {
                if (internalLogFile != null && internalLogFile.exists()) internalLogFile.delete();
                if (publicLogFile != null && publicLogFile.exists()) publicLogFile.delete();
                File dlLog = new File("/sdcard/Download/streamsutra_debug.log");
                if (dlLog.exists()) dlLog.delete();
                log("Logger", "=== Logs cleared by user ===");
            } catch (Exception ignored) {}
        }
    }

    public void enterFullScreen() {
        runOnUiThread(() -> {
            AppLogger.log("Bridge", "enterFullScreen called");
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            hideSystemUI();
        });
    }

    public void exitFullScreen() {
        runOnUiThread(() -> {
            AppLogger.log("Bridge", "exitFullScreen called");
            if (mCustomView != null) {
                hideCustomFullscreenView();
            }
            if (!mIsInPiP) {
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                showSystemUI();
            }
            if (mWebView != null) {
                mWebView.evaluateJavascript("if (window.onExitFullscreenFromAndroid) window.onExitFullscreenFromAndroid();", null);
            }
        });
    }

    // =========================================================================
    // JAVASCRIPT TO NATIVE ANDROID BRIDGE
    // =========================================================================
    public class WebAppInterface {

        @JavascriptInterface
        public void enterFullScreen() {
            MainActivity.this.enterFullScreen();
        }

        @JavascriptInterface
        public void exitFullScreen() {
            MainActivity.this.exitFullScreen();
        }

        @JavascriptInterface
        public void toggleFullScreen() {
            runOnUiThread(() -> {
                AppLogger.log("Bridge", "toggleFullScreen called");
                if (mCustomView != null) {
                    hideCustomFullscreenView();
                    return;
                }
                int orientation = getRequestedOrientation();
                if (orientation == ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    || orientation == ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE) {
                    exitFullScreen();
                } else {
                    enterFullScreen();
                }
            });
        }

        @JavascriptInterface
        public void enterPiPMode() {
            runOnUiThread(() -> {
                AppLogger.log("Bridge", "enterPiPMode called");
                enterPiP();
            });
        }

        @JavascriptInterface
        public boolean isLandscape() {
            int orientation = getRequestedOrientation();
            return (orientation == ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                || orientation == ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
        }

        @JavascriptInterface
        public void showToast(String message) {
            runOnUiThread(() -> {
                AppLogger.log("Bridge", "Toast: " + message);
                Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show();
            });
        }

        @JavascriptInterface
        public void openEmail(String subject, String body) {
            runOnUiThread(() -> {
                try {
                    AppLogger.log("Bridge", "openEmail: " + subject);
                    Intent intent = new Intent(Intent.ACTION_SENDTO);
                    intent.setData(Uri.parse("mailto:"));
                    intent.putExtra(Intent.EXTRA_SUBJECT, subject);
                    intent.putExtra(Intent.EXTRA_TEXT, body);
                    startActivity(Intent.createChooser(intent, "Send Bug Report / Feedback"));
                } catch (Exception e) {
                    AppLogger.log("Bridge", "openEmail error: " + e.getMessage());
                    Toast.makeText(MainActivity.this, "No email app found", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void openUrl(String url) {
            runOnUiThread(() -> {
                try {
                    AppLogger.log("Bridge", "openUrl: " + url);
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception e) {
                    AppLogger.log("Bridge", "Cannot open URL: " + e.getMessage());
                    Toast.makeText(MainActivity.this, "Cannot open URL: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                }
            });
        }

        /**
         * Open magnet link via explicit Flud app (sequential downloader/streamer)
         */
        @JavascriptInterface
        public void openInFlud(String magnetUrl) {
            runOnUiThread(() -> {
                try {
                    AppLogger.log("Bridge", "openInFlud: " + magnetUrl);
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(magnetUrl));
                    intent.setPackage("com.delphicoder.flud");
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception e) {
                    AppLogger.log("Bridge", "Flud launch error: " + e.getMessage() + ", falling back to chooser");
                    openMagnet(magnetUrl);
                }
            });
        }

        /**
         * Open media stream or magnet link via VLC Media Player
         */
        @JavascriptInterface
        public void openInVlc(String streamUrlOrMagnet, String title) {
            runOnUiThread(() -> {
                if (streamUrlOrMagnet == null || streamUrlOrMagnet.trim().isEmpty()) {
                    Toast.makeText(MainActivity.this, "No stream URL provided", Toast.LENGTH_SHORT).show();
                    return;
                }
                if (streamUrlOrMagnet.startsWith("magnet:")) {
                    AppLogger.log("Bridge", "openInVlc received magnet link, redirecting to Flud");
                    Toast.makeText(MainActivity.this, "VLC does not support magnet links; streaming in Flud...", Toast.LENGTH_SHORT).show();
                    openInFlud(streamUrlOrMagnet);
                    return;
                }
                try {
                    AppLogger.log("Bridge", "openInVlc: " + title + " -> " + streamUrlOrMagnet);
                    Intent intent = new Intent(Intent.ACTION_VIEW);
                    Uri uri = Uri.parse(streamUrlOrMagnet);
                    intent.setDataAndType(uri, "video/*");
                    intent.setPackage("org.videolan.vlc");
                    intent.putExtra("title", title != null ? title : "Live TV Stream");
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception e) {
                    AppLogger.log("Bridge", "VLC direct launch failed, trying chooser: " + e.getMessage());
                    try {
                        Intent fallback = new Intent(Intent.ACTION_VIEW);
                        Uri uri = Uri.parse(streamUrlOrMagnet);
                        if (streamUrlOrMagnet.startsWith("magnet:")) {
                            fallback.setData(uri);
                        } else {
                            fallback.setDataAndType(uri, "video/*");
                        }
                        fallback.putExtra("title", title != null ? title : "Live TV Stream");
                        fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(Intent.createChooser(fallback, "Play with..."));
                    } catch (Exception e2) {
                        Toast.makeText(MainActivity.this, "Cannot open VLC: " + e2.getMessage(), Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }

        /**
         * Generic magnet handler opening system app chooser
         */
        @JavascriptInterface
        public void openMagnet(String magnetUrl) {
            runOnUiThread(() -> {
                try {
                    AppLogger.log("Bridge", "openMagnet intent triggered: " + magnetUrl);
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(magnetUrl));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(Intent.createChooser(intent, "Download or Stream with Flud / Torrent App"));
                } catch (Exception e) {
                    AppLogger.log("Bridge", "openMagnet error: " + e.getMessage());
                    Toast.makeText(MainActivity.this, "No Torrent client found.", Toast.LENGTH_LONG).show();
                }
            });
        }

        /**
         * Open any stream in external player (MX Player, Just Player, VLC, etc.)
         */
        @JavascriptInterface
        public void openExternalPlayer(String url, String mimeType, String title) {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW);
                    intent.setDataAndType(Uri.parse(url), mimeType != null ? mimeType : "video/*");
                    intent.putExtra("title", title != null ? title : "Stream");
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(Intent.createChooser(intent, "Play in External Player"));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Cannot launch external player: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                }
            });
        }

        /**
         * Check if package is installed (e.g. org.videolan.vlc or com.delphicoder.flud)
         */
        @JavascriptInterface
        public boolean isPackageInstalled(String packageName) {
            try {
                getPackageManager().getPackageInfo(packageName, 0);
                return true;
            } catch (PackageManager.NameNotFoundException e) {
                return false;
            } catch (Exception e) {
                return false;
            }
        }

        /**
         * Copy text to system clipboard
         */
        @JavascriptInterface
        public void copyToClipboard(String text, String label) {
            runOnUiThread(() -> {
                try {
                    AppLogger.log("Bridge", "copyToClipboard: " + label);
                    ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    ClipData clip = ClipData.newPlainText(label != null ? label : "Copied Text", text);
                    clipboard.setPrimaryClip(clip);
                    Toast.makeText(MainActivity.this, (label != null ? label : "Link") + " copied to clipboard!", Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Copy failed: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void log(String level, String tag, String msg) {
            AppLogger.log(tag != null ? tag : "Web", msg != null ? msg : "");
        }

        @JavascriptInterface
        public String getLogs() {
            return AppLogger.getRecentLogs(400);
        }

        @JavascriptInterface
        public void clearLogs() {
            AppLogger.clearLogs();
        }

        /**
         * Direct native network fetcher bypassing WebView CORS and Mixed Content restrictions.
         * Enables updating channels from any local network IP (e.g. 10.x.x.x, 192.168.x.x, localhost).
         */
        @JavascriptInterface
        public String fetchUrl(String urlStr) {
            return fetchUrlWithHeaders(urlStr, null, null);
        }

        @JavascriptInterface
        public String fetchUrlWithHeaders(String urlStr, String userAgent, String referer) {
            if (urlStr == null || urlStr.trim().isEmpty()) return "";
            try {
                AppLogger.log("Bridge", "Native fetchUrl starting for: " + urlStr);
                URL url = new URL(urlStr);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(12000);
                conn.setReadTimeout(18000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", (userAgent != null && !userAgent.isEmpty()) ? userAgent : "Mozilla/5.0 (Linux; Android 13; Mobile) StreamSutra/1.0");
                if (referer != null && !referer.isEmpty()) {
                    conn.setRequestProperty("Referer", referer);
                }
                conn.setRequestProperty("Accept", "*/*");

                int code = conn.getResponseCode();
                if (code == HttpURLConnection.HTTP_MOVED_PERM || code == HttpURLConnection.HTTP_MOVED_TEMP || code == 307 || code == 308) {
                    String loc = conn.getHeaderField("Location");
                    if (loc != null) {
                        conn.disconnect();
                        url = new URL(loc);
                        conn = (HttpURLConnection) url.openConnection();
                        conn.setConnectTimeout(12000);
                        conn.setReadTimeout(18000);
                        conn.setRequestProperty("User-Agent", (userAgent != null && !userAgent.isEmpty()) ? userAgent : "Mozilla/5.0 (Linux; Android 13; Mobile) StreamSutra/1.0");
                        if (referer != null && !referer.isEmpty()) {
                            conn.setRequestProperty("Referer", referer);
                        }
                        code = conn.getResponseCode();
                    }
                }

                if (code >= 200 && code < 400) {
                    java.io.InputStream inStream = conn.getInputStream();
                    if (urlStr.endsWith(".gz") || "gzip".equalsIgnoreCase(conn.getContentEncoding())) {
                        try {
                            inStream = new java.util.zip.GZIPInputStream(inStream);
                        } catch (Exception gzEx) {
                            // If stream was already decompressed by HttpURLConnection, proceed with raw stream
                        }
                    }
                    BufferedReader reader = new BufferedReader(new java.io.InputStreamReader(inStream, "UTF-8"));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) {
                        sb.append(line).append("\n");
                    }
                    reader.close();
                    AppLogger.log("Bridge", "Native fetchUrl success (" + sb.length() + " chars) from: " + urlStr);
                    return sb.toString();
                } else {
                    AppLogger.log("Bridge", "Native fetchUrl HTTP " + code + " from: " + urlStr);
                    return "";
                }
            } catch (Exception e) {
                AppLogger.log("Bridge", "Native fetchUrl error: " + e.getMessage());
                return "";
            }
        }
    }

    public void enterPiP() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                mIsInPiP = true;
                if (mCustomView != null) {
                    hideCustomFullscreenView();
                }
                if (mWebView != null) {
                    mWebView.onResume();
                    mWebView.resumeTimers();
                    mWebView.evaluateJavascript("if (window.onPiPChanged) window.onPiPChanged(true);", null);
                }
                PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder();
                Rational aspectRatio = new Rational(16, 9);
                builder.setAspectRatio(aspectRatio);
                if (mWebView != null) {
                    Rect visibleRect = new Rect();
                    mWebView.getGlobalVisibleRect(visibleRect);
                    if (visibleRect.width() > 0 && visibleRect.height() > 0) {
                        builder.setSourceRectHint(visibleRect);
                    }
                }
                enterPictureInPictureMode(builder.build());
            } catch (Exception e) {
                mIsInPiP = false;
                AppLogger.log("PiP", "Error entering PiP: " + e.getMessage());
                Toast.makeText(MainActivity.this, "Picture-in-Picture error: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            }
        } else {
            Toast.makeText(this, "Picture-in-Picture requires Android 8.0+", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            enterPiP();
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        mIsInPiP = isInPictureInPictureMode;
        AppLogger.log("PiP", "onPictureInPictureModeChanged: " + isInPictureInPictureMode);
        if (mWebView != null) {
            mWebView.onResume();
            mWebView.resumeTimers();
            mWebView.evaluateJavascript("if (window.onPiPChanged) window.onPiPChanged(" + isInPictureInPictureMode + ");", null);
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        AppLogger.init(this);
        AppLogger.log("Lifecycle", "onCreate");

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Window window = getWindow();
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(Color.parseColor("#14161F"));
            window.setNavigationBarColor(Color.parseColor("#0A0B10"));
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0A0B0E"));

        mWebView = new WebView(this);
        mWebView.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        ));
        root.addView(mWebView);

        mCustomViewContainer = new FrameLayout(this);
        mCustomViewContainer.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        ));
        mCustomViewContainer.setVisibility(View.GONE);
        mCustomViewContainer.setBackgroundColor(Color.BLACK);
        root.addView(mCustomViewContainer);

        setContentView(root);

        initWebView();
        mWebView.loadUrl("https://streamsutra.app/index.html");
    }

    private void initWebView() {
        WebSettings s = mWebView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString("Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36");

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.setAcceptThirdPartyCookies(mWebView, true);
        }

        mWebView.addJavascriptInterface(new WebAppInterface(), "AndroidBridge");
        mWebView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (request != null && request.getUrl() != null) {
                    Uri uri = request.getUrl();
                    if ("streamsutra.app".equals(uri.getHost())) {
                        String path = uri.getPath();
                        if (path == null || path.equals("/") || path.isEmpty()) {
                            path = "index.html";
                        } else if (path.startsWith("/")) {
                            path = path.substring(1);
                        }
                        try {
                            InputStream is = getAssets().open(path);
                            String mime = "text/html";
                            if (path.endsWith(".js")) mime = "application/javascript";
                            else if (path.endsWith(".css")) mime = "text/css";
                            else if (path.endsWith(".json")) mime = "application/json";
                            else if (path.endsWith(".png")) mime = "image/png";
                            else if (path.endsWith(".m3u")) mime = "audio/x-mpegurl";

                            Map<String, String> headers = new HashMap<>();
                            headers.put("Access-Control-Allow-Origin", "*");
                            headers.put("Access-Control-Allow-Methods", "GET, OPTIONS");
                            return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, is);
                        } catch (Exception e) {
                            AppLogger.log("AssetServer", "Failed to open asset: " + path + ": " + e.getMessage());
                        }
                    } else if ("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme())) {
                        String customUa = uri.getQueryParameter("__ua");
                        String customRef = uri.getQueryParameter("__ref");
                        boolean shouldProxy = "http".equalsIgnoreCase(uri.getScheme()) || customUa != null || customRef != null;
                        if (!shouldProxy) {
                            return super.shouldInterceptRequest(view, request);
                        }
                        // Intercept streams to bypass Mixed Content, CORS, and apply custom stream headers
                        try {
                            String targetUrl = uri.toString();
                            if (customUa != null || customRef != null) {
                                targetUrl = targetUrl.replaceAll("[?&]__ua=[^&]+", "").replaceAll("[?&]__ref=[^&]+", "");
                                if (targetUrl.endsWith("?")) targetUrl = targetUrl.substring(0, targetUrl.length() - 1);
                            }
                            URL streamUrl = new URL(targetUrl);
                            HttpURLConnection conn = (HttpURLConnection) streamUrl.openConnection();
                            conn.setInstanceFollowRedirects(true);
                            conn.setConnectTimeout(8000);
                            conn.setReadTimeout(20000);

                            if (request.getRequestHeaders() != null) {
                                for (Map.Entry<String, String> entry : request.getRequestHeaders().entrySet()) {
                                    if (!"Host".equalsIgnoreCase(entry.getKey()) && !"Origin".equalsIgnoreCase(entry.getKey())) {
                                        conn.setRequestProperty(entry.getKey(), entry.getValue());
                                    }
                                }
                            }
                            if (customUa != null && !customUa.isEmpty()) {
                                conn.setRequestProperty("User-Agent", customUa);
                            } else if (conn.getRequestProperty("User-Agent") == null) {
                                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13; Mobile) VLC/3.5.4");
                            }
                            if (customRef != null && !customRef.isEmpty()) {
                                conn.setRequestProperty("Referer", customRef);
                            }

                            int responseCode = conn.getResponseCode();
                            if (responseCode == HttpURLConnection.HTTP_MOVED_PERM || responseCode == HttpURLConnection.HTTP_MOVED_TEMP || responseCode == 307 || responseCode == 308) {
                                String newLocation = conn.getHeaderField("Location");
                                if (newLocation != null) {
                                    conn.disconnect();
                                    streamUrl = new URL(newLocation);
                                    conn = (HttpURLConnection) streamUrl.openConnection();
                                    conn.setInstanceFollowRedirects(true);
                                    conn.setConnectTimeout(8000);
                                    conn.setReadTimeout(20000);
                                    if (customUa != null && !customUa.isEmpty()) {
                                        conn.setRequestProperty("User-Agent", customUa);
                                    } else {
                                        conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13; Mobile) VLC/3.5.4");
                                    }
                                    if (customRef != null && !customRef.isEmpty()) {
                                        conn.setRequestProperty("Referer", customRef);
                                    }
                                    responseCode = conn.getResponseCode();
                                }
                            }

                            InputStream is = (responseCode >= 200 && responseCode < 400) ? conn.getInputStream() : conn.getErrorStream();
                            String mime = conn.getContentType();
                            if (mime == null || mime.isEmpty()) {
                                String uPath = uri.getPath();
                                if (uPath != null && uPath.endsWith(".m3u8")) mime = "application/vnd.apple.mpegurl";
                                else if (uPath != null && uPath.endsWith(".ts")) mime = "video/mp2t";
                                else mime = "application/octet-stream";
                            }
                            if (mime.contains(";")) {
                                mime = mime.split(";")[0].trim();
                            }

                            Map<String, String> headers = new HashMap<>();
                            headers.put("Access-Control-Allow-Origin", "*");
                            headers.put("Access-Control-Allow-Methods", "GET, OPTIONS, HEAD");
                            headers.put("Access-Control-Allow-Headers", "*");
                            String range = conn.getHeaderField("Content-Range");
                            if (range != null) headers.put("Content-Range", range);
                            String acceptRanges = conn.getHeaderField("Accept-Ranges");
                            if (acceptRanges != null) headers.put("Accept-Ranges", acceptRanges);

                            return new WebResourceResponse(mime, "UTF-8", responseCode, conn.getResponseMessage() != null ? conn.getResponseMessage() : "OK", headers, is);
                        } catch (Exception e) {
                            AppLogger.log("HttpProxy", "Error proxying stream: " + e.getMessage());
                        }
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url != null && url.startsWith("magnet:")) {
                    new WebAppInterface().openMagnet(url);
                    return true;
                }
                return super.shouldOverrideUrlLoading(view, url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request != null && request.getUrl() != null) {
                    String url = request.getUrl().toString();
                    if (url.startsWith("magnet:")) {
                        new WebAppInterface().openMagnet(url);
                        return true;
                    }
                }
                return super.shouldOverrideUrlLoading(view, request);
            }
        });

        mWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                AppLogger.log("WebChrome", "onPermissionRequest: " + (request != null && request.getResources() != null ? java.util.Arrays.toString(request.getResources()) : "null"));
                if (request != null) {
                    runOnUiThread(() -> request.grant(request.getResources()));
                }
            }

            private boolean mMixedContentLogged = false;

            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                String msg = cm.message();
                if (msg != null && msg.contains("Mixed Content:")) {
                    if (!mMixedContentLogged) {
                        AppLogger.log("JS-Info", "Mixed Content: Insecure HTTP stream traffic active (allowed by MIXED_CONTENT_ALWAYS_ALLOW)");
                        mMixedContentLogged = true;
                    }
                    return true;
                }
                AppLogger.log("JS-" + cm.messageLevel().name(), 
                    cm.message() + " (" + cm.sourceId() + ":" + cm.lineNumber() + ")");
                return true;
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                AppLogger.log("FileChooser", "onShowFileChooser triggered");
                if (mFilePathCallback != null) {
                    mFilePathCallback.onReceiveValue(null);
                    mFilePathCallback = null;
                }
                mFilePathCallback = filePathCallback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                String[] mimetypes = {"text/*", "application/*", "*/*"};
                intent.putExtra(Intent.EXTRA_MIME_TYPES, mimetypes);
                try {
                    startActivityForResult(Intent.createChooser(intent, "Select Playlist File"), FILE_CHOOSER_REQUEST_CODE);
                    return true;
                } catch (Exception e) {
                    AppLogger.log("FileChooser", "Error launching chooser: " + e.getMessage());
                    if (mFilePathCallback != null) {
                        mFilePathCallback.onReceiveValue(null);
                        mFilePathCallback = null;
                    }
                    return false;
                }
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                AppLogger.log("WebChrome", "onShowCustomView (Delegating to in-app custom fullscreen)");
                if (callback != null) {
                    try {
                        callback.onCustomViewHidden();
                    } catch (Exception e) {}
                }
                runOnUiThread(() -> {
                    enterFullScreen();
                    if (mWebView != null) {
                        mWebView.evaluateJavascript("if (window.enterFullscreenUI) window.enterFullscreenUI(false);", null);
                    }
                });
            }

            @Override
            public void onHideCustomView() {
                hideCustomFullscreenView();
            }
        });
    }

    public void hideCustomFullscreenView() {
        runOnUiThread(() -> {
            if (mCustomView == null) return;
            AppLogger.log("WebChrome", "hideCustomFullscreenView invoked");
            mCustomViewContainer.setVisibility(View.GONE);
            mCustomViewContainer.removeView(mCustomView);
            mCustomView = null;
            if (mCustomViewCallback != null) {
                try {
                    mCustomViewCallback.onCustomViewHidden();
                } catch (Exception e) {}
                mCustomViewCallback = null;
            }
            if (!mIsInPiP) {
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                showSystemUI();
            }
            if (mWebView != null) {
                mWebView.evaluateJavascript("if (window.onExitFullscreenFromAndroid) window.onExitFullscreenFromAndroid();", null);
            }
        });
    }

    private void hideSystemUI() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
        );
    }

    private void showSystemUI() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    // =========================================================================
    // INTUITIVE BACK BUTTON & GESTURE NAVIGATION
    // =========================================================================
    @Override
    public void onBackPressed() {
        AppLogger.log("Nav", "onBackPressed triggered");

        // 1. If currently in HTML5 video fullscreen view, exit it directly
        if (mCustomView != null) {
            AppLogger.log("Nav", "Closing custom fullscreen view");
            hideCustomFullscreenView();
            return;
        }

        // 2. If rotated to landscape, rotate back to portrait first
        int orientation = getRequestedOrientation();
        if (orientation == ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            || orientation == ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE) {
            AppLogger.log("Nav", "Rotating back to portrait from landscape");
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
            showSystemUI();
            mWebView.evaluateJavascript("if (window.onExitFullscreenFromAndroid) window.onExitFullscreenFromAndroid();", null);
            return;
        }

        // 3. Evaluate if JavaScript has an open modal, active stream, or non-home tab to navigate back
        mWebView.evaluateJavascript("try { window.handleAndroidBack ? window.handleAndroidBack() : false; } catch(e) { false; }", value -> {
            boolean handled = "true".equals(value) || "\"true\"".equals(value);
            AppLogger.log("Nav", "handleAndroidBack returned: " + handled);
            if (handled) {
                // Successfully consumed by closing a modal, player or sub-tab
                return;
            }

            // 4. Double-back to exit only when already on the main Live TV screen
            runOnUiThread(() -> {
                long now = System.currentTimeMillis();
                if (now - mLastBackTime < 2500) {
                    AppLogger.log("Nav", "Exiting application on double-back");
                    finish();
                } else {
                    mLastBackTime = now;
                    Toast.makeText(MainActivity.this, "Press BACK again to exit Live TV", Toast.LENGTH_SHORT).show();
                }
            });
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        AppLogger.log("Lifecycle", "onPause (PiP: " + mIsInPiP + ")");
        boolean inPip = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            inPip = isInPictureInPictureMode();
        }
        if (mWebView != null && !inPip && !mIsInPiP) {
            mWebView.onPause();
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        AppLogger.log("Lifecycle", "onStop (PiP: " + mIsInPiP + ")");
        boolean inPip = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            inPip = isInPictureInPictureMode();
        }
        if (mWebView != null && !inPip && !mIsInPiP) {
            mWebView.onPause();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        AppLogger.log("Lifecycle", "onResume");
        if (mWebView != null) {
            mWebView.onResume();
            mWebView.resumeTimers();
            if (mIsInPiP) {
                mIsInPiP = false;
                mWebView.evaluateJavascript("if (window.onPiPChanged) window.onPiPChanged(false);", null);
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (mFilePathCallback != null) {
                Uri[] results = null;
                if (resultCode == Activity.RESULT_OK && data != null) {
                    String dataString = data.getDataString();
                    ClipData clipData = data.getClipData();
                    if (clipData != null) {
                        results = new Uri[clipData.getItemCount()];
                        for (int i = 0; i < clipData.getItemCount(); i++) {
                            results[i] = clipData.getItemAt(i).getUri();
                        }
                    } else if (dataString != null) {
                        results = new Uri[]{Uri.parse(dataString)};
                    } else if (data.getData() != null) {
                        results = new Uri[]{data.getData()};
                    }
                }
                AppLogger.log("FileChooser", "File chooser completed with " + (results != null ? results.length : 0) + " items");
                mFilePathCallback.onReceiveValue(results);
                mFilePathCallback = null;
            }
        }
    }

    @Override
    protected void onDestroy() {
        AppLogger.log("Lifecycle", "onDestroy");
        if (mWebView != null) {
            mWebView.destroy();
        }
        super.onDestroy();
    }
}
