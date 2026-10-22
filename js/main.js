import { MANIFEST } from '../assets/manifest.js';
import { loadAssets } from './render/AssetLoader.js';
import { Game } from './core/Game.js';
import { Menu } from './ui/Menu.js';
import { SaveGame } from './systems/SaveGame.js';

const bar = document.getElementById('loadBar');
const pct = document.getElementById('loadPct');

loadAssets(MANIFEST, (p) => {
  bar.style.width = `${Math.round(p * 100)}%`;
  pct.textContent = `%${Math.round(p * 100)}`;
}).then((assets) => {
  const menu = new Menu((opts) => {
    // Arayüz önce görünür olsun: mini harita vb. boyutlarını kurulumda doğru ölçsün
    document.body.classList.add('ingame');
    const game = new Game(assets, opts);
    menu.game = game;
    game.menu = menu;
    game.start();
    window.game = game; // konsoldan hata ayıklama: game.world, game.camera ...
  });
  document.getElementById('loading').classList.add('done');
  // Oyun içinden "Kaydı Yükle" sayfayı yeniler ve doğrudan kayda açılır
  let boot = null;
  try { boot = sessionStorage.getItem('mi_boot'); sessionStorage.removeItem('mi_boot'); } catch { /* yok say */ }
  const save = boot === 'load' ? SaveGame.load(false) : null;
  if (save) menu._launch({ save });
  else menu.openMain();
}).catch((err) => {
  console.error(err);
  pct.textContent = `Hata: ${err.message}`;
  pct.classList.add('error');
});
