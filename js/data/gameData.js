/**
 * OYUN VERİLERİ (data-driven tasarım)
 * Denge ayarları kodun içine gömülü değil, burada tablo halinde durur.
 * Yeni bir bina/birim/teknoloji eklemek çoğu zaman yalnızca bu dosyaya bir satır eklemek demektir.
 */

export const RESOURCE_TYPES = ['food', 'wood', 'gold', 'stone'];
export const RESOURCE_NAMES = { food: 'Yiyecek', wood: 'Odun', gold: 'Altın', stone: 'Taş' };

/** Oyuncular: 1 = siz (mavi), 2 = düşman (kırmızı) */
export const PLAYER = 1;
export const ENEMY = 2;

/** Çağlar. tier → binaların hangi görsel setle çizileceği (0: ahşap/saz, 1: taş+ahşap, 2: büyük taş). */
export const AGES = [
  { id: 0, name: 'Karanlık Çağ',      short: 'I',   tier: 0 },
  { id: 1, name: 'Feodal Çağ',        short: 'II',  tier: 1, cost: { food: 300 },             time: 25 },
  { id: 2, name: 'Kale Çağı',         short: 'III', tier: 2, cost: { food: 500, gold: 200 },  time: 35 },
  { id: 3, name: 'İmparatorluk Çağı', short: 'IV',  tier: 2, cost: { food: 800, gold: 500 },  time: 45 },
];

/**
 * Binalar.
 *  size       : kare ayak izi (karo)
 *  dropsite   : köylülerin bu binaya bırakabileceği kaynaklar
 *  popProvided: tamamlandığında nüfus sınırına katkı
 *  requires   : inşa edebilmek için önceden tamamlanmış olması gereken bina(lar)
 *  attack     : bina ok atar (Kasaba Merkezi, kule)  { damage, range, reload }
 *  coastal    : yalnızca su kenarına kurulabilir (ayak izinin çevresinde en az 2 su karosu)
 *  income     : tamamlandığında kendiliğinden üretilen kaynak (birim / saniye)
 *  wall/gate  : sürüklenerek çizilen çit / kendi birimlerinin geçebildiği kapı (düşman kırarak geçer)
 *  garrison   : "Köylüleri Çağır" ile içeri sığınabilecek köylü sayısı; her 3 köylü binaya +1 ok ekler
 *  armor      : { melee, pierce } — binalar oklara karşı çok dayanıklıdır
 */
export const BUILDINGS = {
  townCenter: {
    name: 'Kasaba Merkezi', size: 4, hp: 2400, cost: { wood: 275, stone: 100 }, buildTime: 60, age: 0,
    popProvided: 5, dropsite: ['food', 'wood', 'gold', 'stone'], trains: ['villager'], techs: ['wheelbarrow'],
    canAdvanceAge: true, sprite: 'townCenter', buildable: false, armor: { melee: 2, pierce: 8 }, garrison: 15,
    attack: { damage: 5, range: 6, reload: 2 },
    desc: 'Köylü üretir, çağ atlatır, tüm kaynakları kabul eder ve yaklaşan düşmana ok atar.',
  },
  house: {
    name: 'Ev', size: 2, hp: 550, cost: { wood: 25 }, buildTime: 12, age: 0, popProvided: 5, sprite: 'house',
    armor: { melee: 0, pierce: 7 }, desc: 'Nüfus sınırını +5 artırır.',
  },
  lumberCamp: {
    name: 'Kereste Kampı', size: 2, hp: 600, cost: { wood: 100 }, buildTime: 18, age: 0, dropsite: ['wood'],
    techs: ['doubleAxe', 'bowSaw'], sprite: 'lumberCamp', autoGather: 'wood', armor: { melee: 0, pierce: 7 },
    desc: 'Odun bırakma noktası. Ormanın yanına kurun.',
  },
  mill: {
    name: 'Değirmen', size: 2, hp: 600, cost: { wood: 100 }, buildTime: 18, age: 0, dropsite: ['food'],
    techs: ['horseCollar'], sprite: 'mill', autoGather: 'food', armor: { melee: 0, pierce: 7 },
    desc: 'Yiyecek bırakma noktası. Çiftlikleri açar.',
  },
  miningCamp: {
    name: 'Maden Kampı', size: 2, hp: 600, cost: { wood: 100 }, buildTime: 18, age: 0, dropsite: ['gold', 'stone'],
    techs: ['goldMining', 'stoneMining'], sprite: 'miningCamp', autoGather: 'gold', armor: { melee: 0, pierce: 7 },
    desc: 'Altın ve taş bırakma noktası.',
  },
  farm: {
    name: 'Çiftlik', size: 3, hp: 480, cost: { wood: 60 }, buildTime: 10, age: 0, requires: ['mill'],
    walkable: true, farmFood: 300, armor: { melee: 0, pierce: 0 }, desc: 'Köylüler üzerinde çalışarak yiyecek üretir (300 yiyecek).',
  },
  dock: {
    name: 'Tersane', size: 3, hp: 1500, cost: { wood: 150 }, buildTime: 35, age: 0, coastal: true,
    dropsite: ['food', 'wood'], trains: ['fishingBoat'], techs: ['fishNets'], sprite: 'dock', armor: { melee: 0, pierce: 7 },
    desc: 'Yalnızca köylüler su kenarına kurabilir. Balıkçı teknesi üretir; tekneler balık sürülerinden yiyecek toplar. Odun ve yiyecek bırakma noktasıdır.',
  },
  barracks: {
    name: 'Kışla', size: 3, hp: 1200, cost: { wood: 175 }, buildTime: 30, age: 0, trains: ['militia'],
    techs: ['longSword', 'scaleArmor'], sprite: 'barracks', armor: { melee: 0, pierce: 7 },
    desc: 'Milis piyadesi yetiştirir.',
  },
  stable: {
    name: 'Ahır', size: 3, hp: 1200, cost: { wood: 175 }, buildTime: 30, age: 1, requires: ['barracks'],
    trains: ['cavalry'], techs: ['bloodlines'], sprite: 'stable', armor: { melee: 0, pierce: 7 },
    desc: 'Hızlı atlı keşifçi yetiştirir. Önce Kışla gerekir.',
  },
  siegeWorkshop: {
    name: 'Kuşatma Atölyesi', size: 3, hp: 1500, cost: { wood: 200 }, buildTime: 40, age: 2, requires: ['barracks'],
    trains: ['ram'], sprite: 'siegeWorkshop', armor: { melee: 0, pierce: 7 },
    desc: 'Binalara ağır hasar veren koçbaşı üretir.',
  },
  wall: {
    name: 'Ahşap Çit', size: 1, hp: 300, cost: { wood: 3 }, buildTime: 4, age: 0, wall: true, sprite: 'palisade',
    armor: { melee: 2, pierce: 6 }, desc: 'Sürükleyerek çizin. Düşmanı yavaşlatır; düşman ancak kırarak geçebilir.',
  },
  gate: {
    name: 'Kapı', size: 1, hp: 700, cost: { wood: 25 }, buildTime: 12, age: 0, gate: true, sprite: 'gate',
    armor: { melee: 2, pierce: 6 }, desc: 'Çitin içine konur. Kendi birimleriniz geçer, düşman geçemez.',
  },
  archeryRange: {
    name: 'Okçuluk Alanı', size: 3, hp: 1200, cost: { wood: 175 }, buildTime: 30, age: 1, requires: ['barracks'],
    trains: ['archer'], techs: ['fletching'], sprite: 'archeryRange', armor: { melee: 0, pierce: 7 },
    desc: 'Okçu yetiştirir. Önce Kışla gerekir.',
  },
  watchTower: {
    name: 'Gözetleme Kulesi', size: 1, hp: 700, cost: { wood: 25, stone: 125 }, buildTime: 25, age: 1,
    sprite: 'watchTower', armor: { melee: 1, pierce: 7 }, attack: { damage: 5, range: 7, reload: 2 }, garrison: 5,
    desc: 'Menzile giren düşmanlara otomatik ok atar.',
  },
  market: {
    name: 'Pazar', size: 3, hp: 2100, cost: { wood: 175 }, buildTime: 30, age: 1, trade: true, sprite: 'market',
    armor: { melee: 0, pierce: 7 }, desc: 'Kaynak alım-satımı yapılır.',
  },
  wonder: {
    name: 'Harika', size: 5, hp: 4800, cost: { wood: 1000, gold: 1000, stone: 1000 }, buildTime: 120, age: 3,
    sprite: 'wonder', armor: { melee: 2, pierce: 8 },
    desc: 'Medeniyetinizin en büyük eseri. Tamamlandığında zafer kazanırsınız.',
  },
};

/** Köylünün inşa menüsündeki sıra */
export const BUILD_MENU = ['house', 'lumberCamp', 'mill', 'miningCamp', 'farm', 'dock', 'wall', 'gate', 'barracks', 'archeryRange', 'stable', 'watchTower', 'siegeWorkshop', 'market', 'wonder'];

/**
 * Birimler.
 *  attack : hasar      armor: { melee, pierce }      range: 0 = yakın dövüş, > 0 = ok (karo)
 *  reload : saldırı aralığı (sn)      los: görüş mesafesi (otomatik hedef seçimi için)
 *  bldgMul: binalara karşı hasar çarpanı
 */
export const UNITS = {
  villager: {
    name: 'Köylü', cost: { food: 50 }, trainTime: 10, pop: 1, hp: 25, speed: 1.8, carry: 10,
    attack: 3, armor: { melee: 0, pierce: 0 }, range: 0, reload: 2, los: 4, bldgMul: 1,
  },
  militia: {
    name: 'Milis', cost: { food: 60, gold: 20 }, trainTime: 12, pop: 1, hp: 45, speed: 1.6,
    attack: 6, armor: { melee: 0, pierce: 1 }, range: 0, reload: 2, los: 5, bldgMul: 3,
  },
  cavalry: {
    name: 'Atlı Keşifçi', cost: { food: 80, gold: 30 }, trainTime: 16, pop: 1, hp: 75, speed: 2.7,
    attack: 6, armor: { melee: 0, pierce: 2 }, range: 0, reload: 1.9, los: 7, bldgMul: 1,
  },
  ram: {
    name: 'Koçbaşı', cost: { wood: 160, gold: 75 }, trainTime: 30, pop: 1, hp: 175, speed: 0.9,
    attack: 4, armor: { melee: 0, pierce: 150 }, range: 0, reload: 3, los: 4, bldgMul: 30, siege: true,
  },
  fishingBoat: {
    name: 'Balıkçı Teknesi', cost: { wood: 75 }, trainTime: 15, pop: 1, hp: 60, speed: 2.0, carry: 15,
    attack: 0, armor: { melee: 0, pierce: 4 }, range: 0, reload: 2, los: 6, bldgMul: 0, naval: true,
  },
  archer: {
    name: 'Okçu', cost: { wood: 25, gold: 45 }, trainTime: 14, pop: 1, hp: 30, speed: 1.7,
    attack: 4, armor: { melee: 0, pierce: 0 }, range: 4.5, reload: 2, los: 6.5, bldgMul: 0.5,
  },
};

/** Temel toplama hızları (birim / saniye) */
export const GATHER_RATES = { wood: 0.65, food: 0.6, farm: 0.5, gold: 0.55, stone: 0.5, fish: 0.75 };

/** Doğal kaynak düğümleri */
export const RESOURCE_NODES = {
  tree:  { name: 'Ağaç',          resType: 'wood',  amount: 100 },
  berry: { name: 'Meyve Çalısı',  resType: 'food',  amount: 125 },
  gold:  { name: 'Altın Madeni',  resType: 'gold',  amount: 800 },
  stone: { name: 'Taş Ocağı',     resType: 'stone', amount: 350 },
  fish:  { name: 'Balık Sürüsü',  resType: 'food',  amount: 250 },
};

/**
 * Teknolojiler.
 *  effect: Player.modifiers üzerine ÇARPAN olarak uygulanır (toplama, taşıma, hız)
 *  bonus : birim türüne EKLENEN değerler  { militia: { attack: 2 } }
 */
export const TECHS = {
  wheelbarrow: { name: 'El Arabası',        icon: 'wheelbarrow', building: 'townCenter', age: 1, cost: { food: 175, wood: 50 },  time: 20, effect: { carry: 1.3, speed: 1.1 }, desc: 'Köylüler %30 fazla taşır ve %10 hızlı yürür.' },
  doubleAxe:   { name: 'Çift Balta',        icon: 'axe',         building: 'lumberCamp', age: 1, cost: { food: 100, wood: 50 },  time: 15, effect: { wood: 1.2 },  desc: 'Odun toplama +%20.' },
  bowSaw:      { name: 'Yay Testere',       icon: 'build',       building: 'lumberCamp', age: 2, cost: { food: 150, wood: 100 }, time: 20, effect: { wood: 1.2 },  requires: 'doubleAxe', desc: 'Odun toplama +%20.' },
  horseCollar: { name: 'At Koşumu',         icon: 'horseCollar', building: 'mill',       age: 1, cost: { food: 75, wood: 75 },   time: 15, effect: { farm: 1.25 }, desc: 'Çiftlik verimi +%25.' },
  fishNets:    { name: 'Balık Ağları',      icon: 'food',        building: 'dock',       age: 1, cost: { food: 100, wood: 100 }, time: 20, effect: { fish: 1.5 }, desc: 'Balıkçı tekneleri %50 hızlı toplar.' },
  bloodlines:  { name: 'Soy Atlar',         icon: 'horseCollar', building: 'stable',     age: 1, cost: { food: 150, gold: 100 }, time: 25, bonus: { cavalry: { hp: 20 } }, desc: 'Atlılar: +20 can.' },
  goldMining:  { name: 'Altın Madenciliği', icon: 'pickaxe',     building: 'miningCamp', age: 1, cost: { food: 100, wood: 75 },  time: 15, effect: { gold: 1.15 }, desc: 'Altın toplama +%15.' },
  stoneMining: { name: 'Taş Madenciliği',   icon: 'stone',       building: 'miningCamp', age: 1, cost: { food: 100, wood: 75 },  time: 15, effect: { stone: 1.15 }, desc: 'Taş toplama +%15.' },
  longSword:   { name: 'Uzun Kılıç',        icon: 'swords',      building: 'barracks',   age: 1, cost: { food: 100, gold: 40 },  time: 20, bonus: { militia: { attack: 3, hp: 15 } }, desc: 'Milis: +3 saldırı, +15 can.' },
  scaleArmor:  { name: 'Pul Zırh',          icon: 'shield',      building: 'barracks',   age: 2, cost: { food: 100, gold: 60 },  time: 25, bonus: { militia: { melee: 1, pierce: 1 }, archer: { melee: 1, pierce: 1 } }, desc: 'Askerler: +1 yakın dövüş ve +1 ok zırhı.' },
  fletching:   { name: 'Talimli Okçular',   icon: 'quiver',      building: 'archeryRange', age: 1, cost: { food: 100, wood: 50 }, time: 20, bonus: { archer: { attack: 1, range: 1 }, tower: { attack: 1, range: 1 } }, desc: 'Okçular ve kuleler: +1 saldırı, +1 menzil.' },
};

/** Tamir: köylü başına saniyede onarılan can = maxHp / buildTime × HP_RATE; bedel = bina maliyeti × COST oranında */
export const REPAIR = { HP_RATE: 0.6, COST: 0.5 };

/** Pazar fiyatları (100 birim için, altın) */
export const MARKET = { sell: 70, buy: 130, lot: 100 };

/**
 * Düşman yapay zekâsı.
 *  firstWave : ilk saldırıya kadar barış süresi (sn)     interval: dalgalar arası süre
 *  defenders : üssü koruyan başlangıç birlikleri          ageAt: düşmanın çağ atladığı zamanlar (sn)
 */
export const ENEMY_AI = {
  firstWave: 300,
  interval: 150,
  defenders: { militia: 4, archer: 2 },
  maxWave: 16,
  ageAt: [0, 480, 960],
  minDistance: 72,
};

/**
 * Zorluk: düşman dalgalarının zamanı/büyüklüğü ve düşman köylülerinin toplama hızı.
 * Başlangıç kaynakları her zorlukta aynıdır (START).
 */
export const DIFFICULTY = {
  easy:   { name: 'Kolay', firstWave: 720, interval: 280, waveMul: 0.65, enemyGather: 0.7, enemyVillagers: 4 },
  normal: { name: 'Normal', firstWave: 510, interval: 220, waveMul: 1, enemyGather: 1, enemyVillagers: 6 },
  hard:   { name: 'Zor', firstWave: 360, interval: 170, waveMul: 1.4, enemyGather: 1.35, enemyVillagers: 9 },
};

export const START = {
  resources: { food: 1000, wood: 1000, gold: 500, stone: 1000 }, // eski değerlerin 5 katı
  villagers: 3,
  popMax: 200,
};

export function formatCost(cost) {
  return Object.entries(cost).map(([k, v]) => `${v} ${RESOURCE_NAMES[k]}`).join(', ');
}
