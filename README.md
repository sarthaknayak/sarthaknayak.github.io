# Sarthak Nayak

A personal website with an interactive 3D marble tray, five levels, moving
guards, and reset holes. Play with a pointer, keyboard, phone tilt, or optional
camera hand tracking. Best times and progress are saved in the current browser.

## Run locally

Serve this directory with any static web server. For example:

```sh
python3 -m http.server 8000
```

Then visit `http://localhost:8000`. Camera and phone motion need browser
permission and a secure context, such as HTTPS or localhost.

## Publish

The files are ready to serve without an install or build step. For GitHub Pages,
commit this directory's contents to the repository root. Pages serves the
configured publishing branch (`master` in this repository) and `/ (root)` folder.

`CNAME` selects `sarthaknayak.com`; configure that domain in GitHub Pages and at
the domain's DNS provider. Keep the empty `.nojekyll` file and the entire `vendor/`
directory. Upload the extracted files, rather than the ZIP itself. If testing
at the default `github.io` address before configuring the domain, omit `CNAME`
from that preview commit.

## Third-party software

- [Three.js license](vendor/three/LICENSE)
- [MediaPipe license](vendor/mediapipe/LICENSE)

The 3D library, hand-tracking model, and WebAssembly files are bundled locally.
