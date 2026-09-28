package ae.uaedrive.game;

import android.app.Application;
import android.util.Log;

import com.facebook.FacebookSdk;
import com.google.android.gms.games.PlayGamesSdk;

public class UaeDriveApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        if (BuildConfig.PLAY_GAMES_ENABLED) {
            try {
                PlayGamesSdk.initialize(this);
            } catch (Throwable t) {
                Log.w("UAEDrive", "Play Games init failed", t);
            }
        }
        if (BuildConfig.FACEBOOK_ENABLED) {
            try {
                FacebookSdk.setApplicationId(getString(R.string.facebook_app_id));
                FacebookSdk.setClientToken(getString(R.string.facebook_client_token));
                FacebookSdk.sdkInitialize(this);
            } catch (Throwable t) {
                Log.w("UAEDrive", "Facebook init failed", t);
            }
        }
    }
}
