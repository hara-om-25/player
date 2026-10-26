#!/usr/bin/env python3
"""Збирає три застосунки з одного джерела src/ — стиль і поведінка в усіх однакові,
відрізняються лише можливості (FEAT) і назви.

  python3 build.py            — у ../audio-player, ../video-player, ../video-editor
                                (якщо такої папки немає — у dist/<назва>)
"""
import json, os, re, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE = 'https://hara-om-25.github.io/'
AUDIO_EXTS = ['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.flac', '.amr']
VIDEO_EXTS = ['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.3gp']

APPS = [
    dict(id='audio-player', glyph='audio', name='Аудіоплеєр ХАРА ОМ', short='Аудіоплеєр',
         desc='Аудіоплеєр з мітками та збереженням фрагментів у MP3',
         mime='audio/*', exts=AUDIO_EXTS,
         # db/session — як у старому плеєрі, щоб відкритий там плейлист перейшов сюди
         feat=dict(id='audio', video=False, clips=True, trim=False, last=False,
                   db='markplayer', session='session')),
    dict(id='video-player', glyph='video', name='Відеоплеєр ХАРА ОМ', short='Відеоплеєр',
         desc='Відеоплеєр з мітками, покадровою прокруткою та регулятором',
         mime='video/*', exts=VIDEO_EXTS,
         feat=dict(id='video', video=True, clips=False, trim=True, last=True, vslider=True, edit=True,
                   db='markplayer-video', session='session.video')),
    dict(id='video-editor', glyph='editor', name='Відеоредактор ХАРА ОМ', short='Відеоредактор',
         desc='Відеоредактор (поки — точна копія відеоплеєра; далі стане справжнім редактором)',
         mime='video/*', exts=VIDEO_EXTS,
         # стартує як точна копія відеоплеєра — ті самі можливості, свій плейлист
         feat=dict(id='editor', video=True, clips=False, trim=True, last=True, vslider=True, edit=True, draw=True,
                   db='markplayer-editor', session='session.editor')),
]


def read(p):
    with open(os.path.join(ROOT, p), encoding='utf-8') as f:
        return f.read()


def build(app, out):
    html, sw, man = read('src/app.html'), read('src/sw.js'), read('src/manifest.webmanifest')
    ver = re.search(r"APP_VER = '(v\d+)'", html).group(1)
    f = app['feat']
    body = ' '.join('f-' + k for k in ('video', 'clips', 'trim', 'last', 'vslider', 'edit', 'draw') if f.get(k)) + ' app-' + f['id']
    accept = ','.join([app['mime']] + app['exts'])
    for k, v in {'__NAME__': app['name'], '__SHORT__': app['short'], '__ACCEPT__': accept, '__BODYCLASS__': body,
                 '__FEAT__': json.dumps(f, ensure_ascii=False), '__URL__': BASE + app['id'] + '/'}.items():
        html = html.replace(k, v)
    sw = sw.replace('__ID__', app['id']).replace('__VER__', ver)
    man = json.loads(man)
    man.update(name=app['name'], short_name=app['short'], description=app['desc'])
    man['file_handlers'][0]['accept'] = {app['mime']: app['exts']}
    # «Поділитися» з галереї / файлового менеджера Android → файл одразу в плейлист (обробляє sw.js)
    man['share_target'] = {'action': './?share-target', 'method': 'POST', 'enctype': 'multipart/form-data',
                           'params': {'files': [{'name': 'media', 'accept': [app['mime']] + app['exts']}]}}
    leftover = re.findall(r'__[A-Z]+__', html + sw)
    assert not leftover, leftover
    os.makedirs(out, exist_ok=True)
    for name, text in (('index.html', html), ('sw.js', sw),
                       ('manifest.webmanifest', json.dumps(man, ensure_ascii=False, indent=1))):
        with open(os.path.join(out, name), 'w', encoding='utf-8') as fh:
            fh.write(text)
    with open(os.path.join(out, 'README.md'), 'w', encoding='utf-8') as fh:
        fh.write(f"# {app['name']}\n\n{app['desc']}.\n\nАдреса: {BASE}{app['id']}/\n\n"
                 "**Тут нічого не правити вручну** — цей репозиторій збирається скриптом `build.py` "
                 "з репозиторію `player` (спільне джерело `src/` для аудіоплеєра, відеоплеєра й відеоредактора).\n")
    # іконки: логотип, довкола зірки — смуги / око / кадр плівки
    subprocess.run([sys.executable, os.path.join(ROOT, 'logo.py'), 'png', out, app['glyph']], check=True)
    shutil.copytree(os.path.join(ROOT, 'fonts'), os.path.join(out, 'fonts'), dirs_exist_ok=True)
    os.makedirs(os.path.join(ROOT, 'apps'), exist_ok=True)       # іконка — і для сторінки-меню /player/
    shutil.copy(os.path.join(out, 'icon-192.png'), os.path.join(ROOT, 'apps', app['id'] + '.png'))
    print(f"{app['id']:14} {ver} → {out}")


if __name__ == '__main__':
    for app in APPS:
        sib = os.path.join(os.path.dirname(ROOT), app['id'])
        build(app, sib if os.path.isdir(os.path.join(sib, '.git')) else os.path.join(ROOT, 'dist', app['id']))
