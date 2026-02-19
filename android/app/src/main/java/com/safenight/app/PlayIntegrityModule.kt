package com.safenight.app

import com.facebook.react.bridge.*
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityTokenRequest

/**
 * PlayIntegrityModule — React Native native module for Google Play Integrity API.
 *
 * Requests an integrity token that the backend can verify against Google's servers
 * to confirm the app is genuine, unmodified, and installed from the Play Store.
 *
 * Usage from JS/TS:
 *   import { NativeModules } from 'react-native';
 *   const token = await NativeModules.PlayIntegrity.requestIntegrityToken(nonce);
 */
class PlayIntegrityModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "PlayIntegrity"

    /**
     * Request a Play Integrity token.
     *
     * @param nonce  A server-supplied Base64url-encoded nonce (min 16 bytes, max 500 bytes).
     *               Should be unique per sensitive request to prevent replay attacks.
     * @param promise Resolves with the integrity token string, or rejects on failure.
     */
    @ReactMethod
    fun requestIntegrityToken(nonce: String, promise: Promise) {
        try {
            val integrityManager = IntegrityManagerFactory.create(reactApplicationContext)

            val request = IntegrityTokenRequest.builder()
                .setNonce(nonce)
                .build()

            integrityManager
                .requestIntegrityToken(request)
                .addOnSuccessListener { response ->
                    promise.resolve(response.token())
                }
                .addOnFailureListener { e ->
                    promise.reject("PLAY_INTEGRITY_ERROR", e.message ?: "Unknown error", e)
                }
        } catch (e: Exception) {
            promise.reject("PLAY_INTEGRITY_INIT_ERROR", e.message ?: "Failed to initialise Play Integrity", e)
        }
    }
}
