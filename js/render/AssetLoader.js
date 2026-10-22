/**
 * AssetLoader: manifest'teki tüm görselleri paralel yükler, ilerlemeyi bildirir.
 * Oyun, tüm görseller hazır olmadan başlamaz (yarım çizilmiş kare görünmesin).
 * Hata olursa, sunucudan HTTP durumunu sorgulayıp kullanıcıya NEDENİNİ ve ÇÖZÜMÜNÜ söyler.
 */
export async function loadAssets(manifest, onProgress = () => {}) {
  if (location.protocol === 'file:') {
    throw new Error('Oyun dosyadan (file://) açılmış. Tarayıcılar bu durumda modülleri ve görselleri engeller. ' +
      'Klasördeki baslat.bat (Windows) veya baslat.sh (macOS/Linux) dosyasını çalıştırın.');
  }
  const jobs = [];
  for (const group of ['sprites', 'icons', 'textures', 'anims']) {
    for (const [key, meta] of Object.entries(manifest[group] ?? {})) jobs.push({ group, key, file: meta.file });
  }
  const out = { sprites: {}, icons: {}, textures: {}, anims: {} };
  let done = 0;
  const load = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(src);
    img.src = src;
  });
  try {
    await Promise.all(jobs.map(async (j) => {
      const img = await load(j.file);
      // decode(): görüntüyü ana iş parçacığı dışında çözer → ilk çizimde takılma olmaz.
      // Bazı tarayıcılarda sekme arka plandayken hiç sonuçlanmayabilir → en fazla 1,5 sn beklenir.
      if (img.decode) await Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
      out[j.group][j.key] = img;
      onProgress(++done / jobs.length);
    }));
  } catch (src) {
    throw new Error(await diagnose(src));
  }
  return out;
}

/** Yüklenemeyen dosya için sunucuya sorup anlaşılır bir hata metni üretir. */
async function diagnose(src) {
  const ext = src.split('.').pop().toLowerCase();
  let status = 0, type = '';
  try {
    const res = await fetch(src, { cache: 'no-store' });
    status = res.status;
    type = res.headers.get('content-type') ?? '';
  } catch { /* ağ hatası */ }
  if (status === 404 && ext === 'webp') {
    return `Sunucu .webp dosyalarını sunmuyor (HTTP 404: ${src}). Visual Studio / IIS Express kullanıyorsanız ` +
      'klasördeki web.config dosyası bunu çözer; projeyi bu klasörün kendisi kök olacak şekilde açın. ' +
      'En kolay yol: baslat.bat ile açmak.';
  }
  if (status === 404) return `Dosya bulunamadı (HTTP 404): ${src}. Zip'in tamamen açıldığından ve sunucunun proje klasöründen başlatıldığından emin olun.`;
  if (status >= 200 && status < 300) return `Görsel çözülemedi: ${src} (sunucu türü: "${type || 'yok'}"). Tarayıcınızı güncelleyin veya baslat.bat ile açın.`;
  return `Görsel yüklenemedi: ${src}${status ? ` (HTTP ${status})` : ''}. Oyunu baslat.bat (Windows) veya baslat.sh ile açın.`;
}
