/**
 * LemonSlice pushes the avatar video into a Daily room rather than back over the
 * WebSocket, so something has to join that room and render it. daily-js runs in
 * a WebView, which keeps react-native-webrtc out of the build.
 *
 * A call object is used instead of Daily's prebuilt frame so the page joins
 * automatically and shows only the avatar — no lobby, no controls.
 */

const escapeJs = (value: string) => JSON.stringify(value)

export const buildDailyViewerHtml = (roomUrl: string, token: string) => `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: transparent; overflow: hidden; }
  video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
</style>
</head>
<body>
<video id="avatar" autoplay playsinline muted></video>
<audio id="voice" autoplay></audio>
<script src="https://cdn.jsdelivr.net/npm/@daily-co/daily-js"></script>
<script>
(function () {
  var post = function (msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  };
  var fail = function (message) { post({ type: 'error', message: String(message) }); };

  window.onerror = function (message) { fail('page error: ' + message); };

  if (!window.DailyIframe) {
    fail('daily-js failed to load — check the network');
    return;
  }

  var video = document.getElementById('avatar');
  var voice = document.getElementById('voice');

  // Video and audio live in separate elements: the video element stays muted so
  // autoplay is never blocked, and the audio element carries the voice.
  var setTrack = function (element, track) {
    var stream = new MediaStream();
    stream.addTrack(track);
    // Re-assigning srcObject is what starts rendering; mutating an attached
    // MediaStream does not reliably repaint inside a WebView.
    element.srcObject = stream;
    var attempt = element.play();
    if (attempt && attempt.catch) attempt.catch(function (e) { fail('play() rejected: ' + e); });
  };

  var call = window.DailyIframe.createCallObject({ subscribeToTracksAutomatically: true });

  call.on('track-started', function (event) {
    if (event.participant && event.participant.local) return;
    if (event.track.kind === 'video') {
      setTrack(video, event.track);
      post({ type: 'video' });
    } else if (event.track.kind === 'audio') {
      setTrack(voice, event.track);
    }
  });

  call.on('participant-left', function (event) {
    if (event.participant && !event.participant.local) post({ type: 'left' });
  });

  call.on('error', function (event) {
    fail('daily error: ' + (event && event.errorMsg ? event.errorMsg : ''));
  });

  // Joining muted with the camera off means no permission prompts: we only watch.
  call
    .join({ url: ${escapeJs(roomUrl)}, token: ${escapeJs(token)}, startVideoOff: true, startAudioOff: true })
    .catch(function (error) { fail('join failed: ' + (error && error.message ? error.message : error)); });
})();
</script>
</body>
</html>`
