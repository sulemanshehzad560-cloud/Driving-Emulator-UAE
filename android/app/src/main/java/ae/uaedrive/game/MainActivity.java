package ae.uaedrive.game;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import com.facebook.AccessToken;
import com.facebook.CallbackManager;
import com.facebook.FacebookCallback;
import com.facebook.FacebookException;
import com.facebook.GraphRequest;
import com.facebook.login.LoginManager;
import com.facebook.login.LoginResult;
import com.google.android.gms.games.PlayGames;

import org.json.JSONObject;

import java.util.Collections;

/**
 * Hosts the WebGL game in a full-screen WebView and exposes a small native
 * bridge (sign-in, keep-screen-on, vibration) as window.AndroidBridge.
 */
public class MainActivity extends Activity {
    private static final String TAG = "UAEDrive";
    private static final int REQ_FILES = 41;
    private static final int REQ_LOCATION = 42;
    private static final String START_URL = "https://appassets.androidplatform.net/assets/www/index.html";

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;
    private CallbackManager fbCallbacks;
    private String fbPendingId;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            getWindow().getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        web = new WebView(this);
        web.setBackgroundColor(0xFF07090D);
        setContentView(web);
        hideSystemBars();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW); // many radio streams are http
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " UAEDrive/" + BuildConfig.VERSION_NAME);
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(@NonNull WebView view, @NonNull WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("appassets.androidplatform.net".equals(uri.getHost())) return false;
                // open external links (privacy policy, OSM copyright) in the browser
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception e) {
                    Log.w(TAG, "No browser", e);
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("audio/*");
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(i, "Choose songs"), REQ_FILES);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                } else {
                    geoCallback = callback;
                    geoOrigin = origin;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
                }
            }
        });
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START_URL);
    }

    private void hideSystemBars() {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.__onBackPressed ? window.__onBackPressed() : false", value -> {
            if (!"true".equals(value)) moveTaskToBack(true);
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILES) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    result = new Uri[n];
                    for (int i = 0; i < n; i++) result[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
            if (fileCallback != null) fileCallback.onReceiveValue(result);
            fileCallback = null;
            return;
        }
        if (fbCallbacks != null) fbCallbacks.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQ_LOCATION && geoCallback != null) {
            boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            geoCallback.invoke(geoOrigin, ok, false);
            geoCallback = null;
        }
    }

    // ------------------------------------------------------------ sign-in

    private void reply(String id, JSONObject json) {
        final String js = "window.__nativeCallback && window.__nativeCallback(" + JSONObject.quote(id) + "," + JSONObject.quote(json.toString()) + ")";
        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    private void replyError(String id, String message) {
        try {
            reply(id, new JSONObject().put("error", message));
        } catch (Exception ignored) {
        }
    }

    private void signInGoogle(String id) {
        if (!BuildConfig.PLAY_GAMES_ENABLED) {
            replyError(id, "Google Play Games is not configured in this build.");
            return;
        }
        PlayGames.getGamesSignInClient(this).signIn().addOnCompleteListener(task -> {
            boolean ok = task.isSuccessful() && task.getResult() != null && task.getResult().isAuthenticated();
            if (!ok) {
                replyError(id, "Google Play Games sign-in was cancelled or failed.");
                return;
            }
            PlayGames.getPlayersClient(this).getCurrentPlayer().addOnCompleteListener(p -> {
                try {
                    JSONObject o = new JSONObject().put("provider", "google");
                    if (p.isSuccessful() && p.getResult() != null) {
                        o.put("id", p.getResult().getPlayerId());
                        o.put("name", p.getResult().getDisplayName());
                    }
                    reply(id, o);
                } catch (Exception e) {
                    replyError(id, e.getMessage());
                }
            });
        });
    }

    @SuppressWarnings("deprecation")
    private void signInFacebook(String id) {
        if (!BuildConfig.FACEBOOK_ENABLED) {
            replyError(id, "Facebook sign-in is not configured in this build.");
            return;
        }
        if (fbCallbacks == null) fbCallbacks = CallbackManager.Factory.create();
        fbPendingId = id;
        LoginManager.getInstance().registerCallback(fbCallbacks, new FacebookCallback<LoginResult>() {
            @Override
            public void onSuccess(LoginResult result) {
                fetchFacebookProfile(fbPendingId, result.getAccessToken());
            }

            @Override
            public void onCancel() {
                replyError(fbPendingId, "Facebook sign-in cancelled.");
            }

            @Override
            public void onError(@NonNull FacebookException error) {
                replyError(fbPendingId, "Facebook sign-in failed: " + error.getMessage());
            }
        });
        LoginManager.getInstance().logInWithReadPermissions(this, Collections.singletonList("public_profile"));
    }

    private void fetchFacebookProfile(String id, AccessToken token) {
        GraphRequest req = GraphRequest.newMeRequest(token, (obj, response) -> {
            try {
                JSONObject o = new JSONObject().put("provider", "facebook");
                if (obj != null) {
                    o.put("id", obj.optString("id"));
                    o.put("name", obj.optString("name"));
                    o.put("avatar", "https://graph.facebook.com/" + obj.optString("id") + "/picture?type=large");
                }
                reply(id, o);
            } catch (Exception e) {
                replyError(id, e.getMessage());
            }
        });
        Bundle params = new Bundle();
        params.putString("fields", "id,name");
        req.setParameters(params);
        req.executeAsync();
    }

    /** Methods callable from JavaScript as window.AndroidBridge.* */
    private class Bridge {
        @JavascriptInterface
        public String providers() {
            try {
                return new JSONObject()
                        .put("google", BuildConfig.PLAY_GAMES_ENABLED)
                        .put("facebook", BuildConfig.FACEBOOK_ENABLED)
                        .toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void signIn(String provider, String callbackId) {
            runOnUiThread(() -> {
                if ("google".equals(provider)) signInGoogle(callbackId);
                else if ("facebook".equals(provider)) signInFacebook(callbackId);
                else replyError(callbackId, "Unknown provider " + provider);
            });
        }

        @JavascriptInterface
        public void signOut(String provider) {
            runOnUiThread(() -> {
                if (BuildConfig.FACEBOOK_ENABLED) {
                    try {
                        LoginManager.getInstance().logOut();
                    } catch (Throwable ignored) {
                    }
                }
            });
        }

        @JavascriptInterface
        public void setKeepScreenOn(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        @JavascriptInterface
        public void vibrate(int ms) {
            Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v == null) return;
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(Math.max(1, ms), VibrationEffect.DEFAULT_AMPLITUDE));
            else v.vibrate(ms);
        }

        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }
    }
}
