# How-to videos

Short screen recordings of the portal doing each thing, shown under **How-to
videos** in the menu, on the dashboard card, and from the "Watch how" buttons.
The catalogue (titles, blurbs, which page and package each belongs to) is in
`server/learn.js`; the server serves this folder at `/videos`, so the files are
not part of the app bundle the iPhone app downloads.

One `<key>.mp4` (H.264, 1280×800, captioned on screen and narrated — OpenAI
text-to-speech, the "fable" voice reading the captions, over a quiet
synthesised bed) and one `<key>.jpg` poster per video. To replace a video with your own recording, drop
in an mp4 with the same name — nothing else needs to change. To add one, add a
row to `VIDEOS` in `server/learn.js` and the two files here.
