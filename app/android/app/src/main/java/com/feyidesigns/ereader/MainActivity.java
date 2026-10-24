package com.feyidesigns.ereader;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // A book shared from another app arrives as SEND with the file in EXTRA_STREAM. The App plugin only
    // reports VIEW intents, so a share is rewritten as a view of the same file before Capacitor sees it.
    private static Intent asView(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return intent;
        Uri file = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (file == null) return intent;
        intent.setAction(Intent.ACTION_VIEW);
        intent.setDataAndType(file, intent.getType());
        return intent;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        setIntent(asView(getIntent()));
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(asView(intent));
    }
}
