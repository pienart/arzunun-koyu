/**
 * ANİMASYON ZAMANLAMASI (kare dizileri: assets/anims/*.webp, tools/process_anim.py üretir)
 *
 *  stride : yürüyüş döngüsünün bir turunda alınan yol (karo). Kare, zamana değil MESAFEYE bağlı ilerler →
 *           birim hızlansa da yavaşlasa da ayak "kaymaz".
 *  period : iş döngüsünün süresi (sn). Saldırılarda kullanılmaz: saldırı döngüsü birimin yeniden dolma
 *           süresine (reload) eşitlenir, böylece görsel vuruş anı hasarla aynı ana düşer.
 *  hit    : döngü içinde aletin hedefe değdiği an (0..1). İş sesleri (balta, kazma, çekiç) bu anda çalar.
 *
 * Simülasyon (World/Unit) da bu tabloyu okur ama yalnızca sayıları; görsellerden habersizdir.
 */
export const ANIMS = {
  vil_walk:   { stride: 1.3 },
  vil_carry:  { stride: 1.2 },
  vil_chop:   { period: 1.1, hit: 0.43 },
  vil_mine:   { period: 1.1, hit: 0.43 },
  vil_build:  { period: 1.0, hit: 0.85 },
  vil_gather: { period: 1.4, hit: 0.5 },
  mil_walk:   { stride: 1.35 },
  mil_attack: { hit: 0.45 },
  arc_walk:   { stride: 1.35 },
  arc_shoot:  { hit: 0.05 },
  cav_walk:   { stride: 2.2 },
  cav_attack: { hit: 0.42 },
  yeti_walk:  { stride: 1.6 },
  arch_walk:  { stride: 1.3 },
  arch_build: { period: 2.0, hit: 0.5 },
  yeti_attack: { hit: 0.55 },
};

export const UNIT_PREFIX = { villager: 'vil', militia: 'mil', archer: 'arc', cavalry: 'cav', ram: 'ram', fishingBoat: 'boat', yeti: 'yeti', architect: 'arch', commander: 'mil', cart: 'cart', catapult: 'catapult', warWagon: 'warWagon', gazelle: 'gazelle', deer: 'deer', rabbit: 'rabbit', horse: 'horse' };

/** Yönlü SABİT görselli birimler (araç/tekne): dünya birimi cinsinden boy; kare yok, Renderer sallar/iter */
export const VEHICLE_HEIGHT = { ram: 56, fishingBoat: 64, cart: 58, catapult: 60, warWagon: 76 };

/**
 * 8 YÖNLÜ YÜRÜYÜŞ
 * Ekrandaki hareket açısı (0° = sağ, 90° = aşağı) 45°'lik dilimlere bölünür. Doğu tarafının 5 yönü için ayrı
 * animasyon vardır (_e yan görünüm = soneksiz anahtar, _se, _s, _ne, _n); batı yönleri bunların aynasıdır.
 */
export const WALK_DIRS = [
  { suffix: '', flip: false },     // 0  doğu (sağ)
  { suffix: '_se', flip: false },  // 1  güneydoğu (sağ-aşağı, kameraya doğru)
  { suffix: '_s', flip: false },   // 2  güney (kameraya doğru)
  { suffix: '_se', flip: true },   // 3  güneybatı
  { suffix: '', flip: true },      // 4  batı
  { suffix: '_ne', flip: true },   // 5  kuzeybatı
  { suffix: '_n', flip: false },   // 6  kuzey (kameradan uzağa)
  { suffix: '_ne', flip: false },  // 7  kuzeydoğu (sağ-yukarı)
];
