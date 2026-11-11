"""Builds the app from index.src.html + engine.js + problems.js.
index.html    -> full page for GitHub Pages (installable, works offline)
artifact.html -> body-only version for the claude.ai artifact (it adds its own <head>)"""
import pathlib
d = pathlib.Path(__file__).parent
src = (d / 'engine.js').read_text() + "\n" + (d / 'problems.js').read_text()
assert '</script' not in src
body = (d / 'index.src.html').read_text().replace('/*ENGINE_SRC*/', src)
(d / 'artifact.html').write_text(body)
head = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#f6f1e8">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Go Dojo">
<link rel="manifest" href="manifest.json">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
'''
tail = '''
<script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});</script>
</body>
</html>
'''
(d / 'index.html').write_text(head + body + tail)
print('built index.html and artifact.html')
