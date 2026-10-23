/**
 * OYUN VERİLERİ (data-driven tasarım)
 * Denge ayarları kodun içine gömülü değil, burada tablo halinde durur.
 * Yeni bir bina/birim/teknoloji eklemek çoğu zaman yalnızca bu dosyaya bir satır eklemek demektir.
 */

// hide (deri): avlanan yabani hayvanlardan; kışlık giysi ve zırh araştırmalarında kullanılır
export const RESOURCE_TYPES = ['food', 'wood', 'gold', 'stone', 'hide'];
export const RESOURCE_NAMES = { food: 'Yiyecek', wood: 'Odun', gold: 'Altın', stone: 'Taş', hide: 'Deri' };

/** Oyuncular: 1 = siz (mavi), 2 = düşman (kırmızı), 3 = vahşi doğa (mağaradaki yaratık; herkese saldırır) */
export const PLAYER = 1;
export const ENEMY = 2;
export const WILD = 3;

/** Yabani hayvanlar: sahibi yok sayılır (WILD), askerler kendiliğinden saldırmaz; köylüler avlar */

/**
 * Çağlar. tier → binaların hangi görsel setle çizileceği (0: ahşap/saz, 1: taş+ahşap, 2: büyük taş).
 * req: çağ atlamak için kaynak YETMEZ — en az `military` asker ve listedeki binalardan (tamamlanmış) bu kadar gerekir.
 */
export const AGES = [
  { id: 0, name: 'Karanlık Çağ',      short: 'I',   tier: 0 },
  { id: 1, name: 'Feodal Çağ',        short: 'II',  tier: 1, cost: { food: 300 },             time: 90,
    req: { military: 3, buildings: { house: 2, lumberCamp: 1, mill: 1, barracks: 1 } } },
  { id: 2, name: 'Kale Çağı',         short: 'III', tier: 2, cost: { food: 500, gold: 200 },  time: 140,
    req: { military: 8, buildings: { house: 5, scienceCenter: 1, archeryRange: 1, market: 1, watchTower: 1, animalFarm: 1 } } },
  { id: 3, name: 'İmparatorluk Çağı', short: 'IV',  tier: 2, cost: { food: 800, gold: 500 },  time: 200,
    req: { military: 15, buildings: { house: 8, stable: 1, siegeWorkshop: 1, university: 1, alchemyLab: 1 } } },
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
 *  levels     : üretim binası yükseltilebilir (en fazla MAX_LEVEL); her seviye üretimi artırır (LEVELS)
 *  tiers      : çağa göre ad/can/zırh/maliyet (çit → taş sur → kale suru); görsel `${sprite}_${tier}`
 *  light      : gece yanan ateş (ateş çukuru): çevresini geniş bir ışık halkasıyla aydınlatır
 */
export const BUILDINGS = {
  townCenter: {
    name: 'Kasaba Merkezi', size: 4, hp: 2400, cost: { wood: 275, stone: 100 }, buildTime: 60, age: 0,
    popProvided: 5, dropsite: ['food', 'wood', 'gold', 'stone'], trains: ['villager', 'cart'],
    canAdvanceAge: true, sprite: 'townCenter', buildAge: 1, limit: 2, armor: { melee: 2, pierce: 8 }, garrison: 15,
    attack: { damage: 5, range: 6, reload: 2 },
    desc: 'Köylü üretir, çağ atlatır, tüm kaynakları kabul eder ve yaklaşan düşmana ok atar. Feodal Çağ\'dan itibaren köylüler bir tane daha kurabilir.',
  },
  house: {
    name: 'Ev', size: 2, hp: 550, cost: { wood: 25 }, buildTime: 12, age: 0, popProvided: 5, sprite: 'house',
    armor: { melee: 0, pierce: 7 }, desc: 'Nüfus sınırını +5 artırır.',
  },
  lumberCamp: {
    name: 'Kereste Kampı', size: 2, hp: 600, cost: { wood: 100 }, buildTime: 18, age: 0, dropsite: ['wood'],
    sprite: 'lumberCamp', autoGather: 'wood', armor: { melee: 0, pierce: 7 }, levels: true,
    desc: 'Odun bırakma noktası. Ormanın yanına kurun.',
  },
  mill: {
    name: 'Değirmen', size: 2, hp: 600, cost: { wood: 100 }, buildTime: 18, age: 0, dropsite: ['food'],
    sprite: 'mill', autoGather: 'food', armor: { melee: 0, pierce: 7 }, levels: true,
    desc: 'Yiyecek bırakma noktası. Çiftlikleri açar.',
  },
  miningCamp: {
    name: 'Maden Kampı', size: 2, hp: 600, cost: { wood: 100 }, buildTime: 18, age: 0, dropsite: ['gold', 'stone'],
    sprite: 'miningCamp', autoGather: 'gold', armor: { melee: 0, pierce: 7 }, levels: true,
    desc: 'Altın ve taş bırakma noktası.',
  },
  farm: {
    name: 'Çiftlik', size: 3, hp: 480, cost: { wood: 60 }, buildTime: 10, age: 0, requires: ['mill'],
    walkable: true, farmFood: 1200, armor: { melee: 0, pierce: 0 }, levels: true, desc: 'Köylüler üzerinde çalışarak yiyecek üretir (1200 yiyecek; her seviye kapasiteyi artırır).',
  },
  dock: {
    name: 'Tersane', size: 3, hp: 1500, cost: { wood: 150 }, buildTime: 35, age: 0, coastal: true,
    dropsite: ['food', 'wood'], trains: ['fishingBoat'], sprite: 'dock', incomeMod: 'fish', armor: { melee: 0, pierce: 7 }, levels: true,
    desc: 'Yalnızca köylüler su kenarına kurabilir. Balıkçı teknesi üretir; tekneler balık sürülerinden yiyecek toplar. Odun ve yiyecek bırakma noktasıdır.',
  },
  barracks: {
    name: 'Kışla', size: 3, hp: 1200, cost: { wood: 175 }, buildTime: 30, age: 0, trains: ['militia', 'commander'],
    sprite: 'barracks', armor: { melee: 0, pierce: 7 },
    desc: 'Milis piyadesi yetiştirir.',
  },
  stable: {
    name: 'Ahır', size: 3, hp: 1200, cost: { wood: 175 }, buildTime: 30, age: 1, requires: ['barracks'],
    trains: ['cavalry'], sprite: 'stable', armor: { melee: 0, pierce: 7 },
    desc: 'Hızlı atlı keşifçi yetiştirir. Önce Kışla gerekir.',
  },
  siegeWorkshop: {
    name: 'Kuşatma Atölyesi', size: 3, hp: 1500, cost: { wood: 200 }, buildTime: 40, age: 2, requires: ['barracks'],
    trains: ['ram', 'catapult', 'warWagon'], sprite: 'siegeWorkshop', armor: { melee: 0, pierce: 7 },
    desc: 'Binalara ağır hasar veren koçbaşı üretir.',
  },
  wall: {
    name: 'Ahşap Çit', size: 1, hp: 300, cost: { wood: 3 }, buildTime: 4, age: 0, wall: true, sprite: 'palisade',
    armor: { melee: 2, pierce: 6 }, desc: 'Sürükleyerek çizin. Düşmanı yavaşlatır; düşman ancak kırarak geçebilir. Çağ atladıkça taş sura, sonra kale suruna dönüşür.',
    tiers: [
      { name: 'Ahşap Çit', hp: 300, armor: { melee: 2, pierce: 6 }, cost: { wood: 3 } },
      { name: 'Taş Sur', hp: 1100, armor: { melee: 6, pierce: 10 }, cost: { stone: 5 } },
      { name: 'Kale Suru', hp: 2600, armor: { melee: 10, pierce: 14 }, cost: { stone: 8 } },
    ],
  },
  gate: {
    name: 'Kapı', size: 1, hp: 700, cost: { wood: 25 }, buildTime: 12, age: 0, gate: true, sprite: 'gate',
    armor: { melee: 2, pierce: 6 }, desc: 'Surun içine konur. Kendi birimleriniz geçer, düşman geçemez. Çağla birlikte güçlenir.',
    tiers: [
      { name: 'Ahşap Kapı', hp: 700, armor: { melee: 2, pierce: 6 }, cost: { wood: 25 } },
      { name: 'Taş Kapı', hp: 1800, armor: { melee: 6, pierce: 10 }, cost: { stone: 30 } },
      { name: 'Kale Kapısı', hp: 3600, armor: { melee: 10, pierce: 14 }, cost: { stone: 45 } },
    ],
  },
  // ── Halk, gıda ve depolama ──
  tavern: {
    name: 'Taverna', size: 3, hp: 1200, cost: { wood: 200, gold: 50 }, buildTime: 35, age: 1, sprite: 'tavern',
    happiness: 7, wineUse: 0.04, limit: 4, armor: { melee: 0, pierce: 7 },
    desc: 'Halkın eğlendiği yer: huzuru artırır (+7; şarap yoksa yalnızca +2). Şarap Mahzeni\'nin şarabını tüketir.',
  },
  wineCellar: {
    name: 'Şarap Mahzeni', size: 2, hp: 800, cost: { wood: 120, stone: 60 }, buildTime: 25, age: 1, sprite: 'wineCellar',
    wine: { make: 0.08, food: 0.16 }, armor: { melee: 1, pierce: 8 },
    desc: 'Yiyecekten şarap yapar (dakikada ~10 yiyecek → 5 şarap). Tavernalar şarapla halkı mutlu eder.',
  },
  granary: {
    name: 'Ambar', size: 3, hp: 1400, cost: { wood: 200, stone: 50 }, buildTime: 30, age: 0, sprite: 'granary', levels: true,
    protect: 0.05, armor: { melee: 1, pierce: 8 },
    desc: 'Güvenli depo: yağmada kaynakların %5\'ini korur (seviye başına +%5, ambarlar toplanır, en fazla %40). Kışın gıda tüketimindeki artışı azaltır.',
  },
  greenhouse: {
    name: 'Sera', size: 3, hp: 900, cost: { wood: 150, stone: 50, gold: 50 }, buildTime: 35, age: 1, sprite: 'greenhouse',
    income: { food: 0.35 }, incomeMod: 'farm', levels: true, winterOk: true, armor: { melee: 0, pierce: 5 },
    desc: 'Cam altında sebze: kendiliğinden dakikada 21 yiyecek, KIŞIN DE. Kışın köylüler dışarıdan gıda toplayamaz; sera ve sebze yatakları çalışır.',
  },
  vegetableBed: {
    name: 'Sebze Yatağı', size: 2, hp: 300, cost: { wood: 50 }, buildTime: 10, age: 0, sprite: 'vegetableBed',
    farmFood: 1000, winterOk: true, farmMul: 1.2, levels: true, armor: { melee: 0, pierce: 3 },
    desc: 'Küçük, verimli bostan (1000 yiyecek, çiftlikten %20 hızlı). Örtülü olduğu için kışın da hasat edilir.',
  },
  waterMill: {
    name: 'Su Değirmeni', size: 2, hp: 700, cost: { wood: 150 }, buildTime: 25, age: 0, coastal: true, sprite: 'waterMill',
    income: { food: 0.2 }, incomeMod: 'farm', levels: true, armor: { melee: 0, pierce: 7 },
    desc: 'Su kenarına kurulur; un öğütür: kendiliğinden az miktarda yiyecek (dakikada 12).',
  },
  goldPanning: {
    name: 'Altın Eleme Tesisi', size: 2, hp: 700, cost: { wood: 150, stone: 50 }, buildTime: 30, age: 1, coastal: true, sprite: 'goldPanning',
    income: { gold: 0.25 }, incomeMod: 'gold', levels: true, armor: { melee: 0, pierce: 7 },
    desc: 'Feodal Çağ\'dan itibaren su kenarına kurulur: kumdan altın eler (dakikada 15 altın).',
  },
  hospital: {
    name: 'Hastane', size: 3, hp: 1500, cost: { wood: 250, stone: 100, gold: 100 }, buildTime: 40, age: 1, sprite: 'hospital',
    heal: { radius: 9, rate: 3 }, revive: { chance: 0.35, time: 25 }, limit: 2, armor: { melee: 1, pierce: 8 },
    desc: 'Çevresindeki (9 karo) yaralı askerleri hızla iyileştirir (saniyede 3 can). Ölen askerlerinizin bir kısmı (%35) 25 sn sonra hastanede iyileşip geri döner.',
  },
  // Otağ: seyyar asker çadırı. 50 asker içine girer; düşman yaklaşınca/çadıra saldırınca kendiliğinden çıkıp savaşır.
  otag: {
    name: 'Otağ', size: 2, hp: 900, cost: { wood: 120, food: 80, hide: 10 }, buildTime: 20, age: 0, requires: ['barracks'], sprite: 'otag',
    troops: 50, portable: true, limit: 4, armor: { melee: 1, pierce: 6 },
    desc: 'Seyyar asker çadırı: 50 asker içine girer (askerleri seçip çadıra sağ tıklayın). Düşman yaklaşırsa ya da çadıra saldırırsa askerler kendiliğinden çıkıp savaşır. Mimarsız ve bedelsiz taşınabilir (seyyar).',
  },
  firePit: {
    name: 'Ateş Çukuru', size: 1, hp: 150, cost: { wood: 30, stone: 10 }, buildTime: 6, age: 0, sprite: 'campfire', light: true,
    armor: { melee: 0, pierce: 4 }, desc: 'Köylüler gece kamp ateşi yakar: çevresi geceleri diğer yerlerden daha aydınlık olur, başında köylüler ısınır.',
  },
  archeryRange: {
    name: 'Okçuluk Alanı', size: 3, hp: 1200, cost: { wood: 175 }, buildTime: 30, age: 1, requires: ['barracks'],
    trains: ['archer'], sprite: 'archeryRange', armor: { melee: 0, pierce: 7 },
    desc: 'Okçu yetiştirir. Önce Kışla gerekir.',
  },
  watchTower: {
    name: 'Gözetleme Kulesi', size: 1, hp: 700, cost: { wood: 25, stone: 125 }, buildTime: 25, age: 1,
    sprite: 'watchTower', armor: { melee: 1, pierce: 7 }, attack: { damage: 5, range: 7, reload: 2 }, garrison: 5,
    desc: 'Menzile giren düşmanlara otomatik ok atar.',
  },
  market: {
    name: 'Pazar', size: 3, hp: 2100, cost: { wood: 175 }, buildTime: 30, age: 1, trade: true, sprite: 'market',
    limit: 1, armor: { melee: 0, pierce: 7 }, desc: 'Kaynak alım-satımı yapılır.',
  },
  animalFarm: {
    name: 'Hayvan Çiftliği', size: 3, hp: 1000, cost: { wood: 200, gold: 50 }, buildTime: 35, age: 1, sprite: 'animalFarm',
    income: { food: 0.5, hide: 0.02 }, incomeMod: 'ranch', levels: true, dayNight: true, armor: { melee: 0, pierce: 7 },
    desc: 'İnekler ve keçiler sağılır: kendiliğinden yiyecek (dakikada 30) ve biraz deri (dakikada ~1) üretir; seviye ve Süt Ürünleri ile artar. Gündüz hayvanlar ağılda, gece ahırın içindedir.',
  },
  scienceCenter: {
    name: 'Bilim Merkezi', size: 3, hp: 1600, cost: { wood: 200, stone: 100 }, buildTime: 40, age: 0, sprite: 'scienceCenter',
    research: true, limit: 1, armor: { melee: 1, pierce: 8 },
    desc: 'Tüm araştırmalar burada yapılır: Köy, Ordu, Sağlık ve Savunma başlıklarında araştırma ağacı.',
  },
  university: {
    name: 'Üniversite', size: 3, hp: 1800, cost: { wood: 250, stone: 150, gold: 100 }, buildTime: 45, age: 2, sprite: 'university',
    trains: ['architect', 'prospector'], limit: 1, armor: { melee: 1, pierce: 8 },
    desc: 'Mimar yetiştirir. Mimarlar patika, çiçek tarhı ve süs ağacıyla şehri güzelleştirir.',
  },
  alchemyLab: {
    name: 'Simya Atölyesi', size: 2, hp: 900, cost: { wood: 150, gold: 150 }, buildTime: 35, age: 2, sprite: 'alchemyLab',
    alchemy: true, limit: 1, armor: { melee: 0, pierce: 7 },
    desc: 'İksirler ve aletler üretir. İksirler envantere eklenir ve istediğiniz an kullanılır; aletler kalıcıdır.',
  },
  // Süslemeler: yalnızca MİMAR kurar (decor). Patika üzerinde birimler %35 hızlı yürür.
  path: {
    name: 'Patika', size: 1, hp: 200, cost: { stone: 2 }, buildTime: 2, age: 0, decor: true, line: true, walkable: true, ground: true,
    armor: { melee: 5, pierce: 10 }, desc: 'Taş döşeli yürüme yolu: sürükleyerek çizin. Üzerinde birimler %35 daha hızlı yürür.',
  },
  flowerBed: {
    name: 'Çiçek Tarhı', size: 1, hp: 100, cost: { wood: 10, food: 10 }, buildTime: 4, age: 0, decor: true, sprite: 'flowerBed', beauty: 1,
    armor: { melee: 0, pierce: 5 }, desc: 'Lale ve lavanta dolu taş kenarlı tarh: şehri güzelleştirir.',
  },
  hedge: {
    name: 'Çit Bitkisi', size: 1, hp: 120, cost: { wood: 4 }, buildTime: 2, age: 0, decor: true, line: true, sprite: 'hedge', beauty: 0.4,
    armor: { melee: 1, pierce: 5 }, desc: 'Budanmış şimşir: sürükleyerek çizin. Bahçe ve yol kenarlarını çevreler (güzellik).',
  },
  bench: {
    name: 'Bank', size: 1, hp: 100, cost: { wood: 15 }, buildTime: 4, age: 0, decor: true, sprite: 'bench', beauty: 1, fit: 0.8,
    armor: { melee: 0, pierce: 5 }, desc: 'Meydana bank: halk dinlenir (güzellik +1).',
  },
  lampPost: {
    name: 'Sokak Feneri', size: 1, hp: 120, cost: { wood: 10, gold: 10 }, buildTime: 4, age: 0, decor: true, sprite: 'lampPost', beauty: 1, lamp: true, fit: 0.32,
    armor: { melee: 0, pierce: 5 }, desc: 'Geceleri yanar: çevresini aydınlatır ve görüşü artırır.',
  },
  well: {
    name: 'Kuyu', size: 1, hp: 300, cost: { stone: 40, wood: 20 }, buildTime: 10, age: 0, decor: true, sprite: 'well', beauty: 2, wellBonus: 0.1, fit: 0.75,
    armor: { melee: 2, pierce: 8 }, desc: 'Temiz su: 8 karo içinde çalışan köylüler %10 hızlı toplar.',
  },
  statue: {
    name: 'Heykel', size: 1, hp: 500, cost: { stone: 120, gold: 40 }, buildTime: 20, age: 1, decor: true, sprite: 'statue', beauty: 4, fit: 0.6,
    armor: { melee: 4, pierce: 10 }, desc: 'Kral heykeli: halkın gururu (güzellik +4).',
  },
  fountain: {
    name: 'Çeşme', size: 2, hp: 600, cost: { stone: 200, gold: 60 }, buildTime: 30, age: 1, decor: true, sprite: 'fountain', beauty: 6, fountain: true,
    armor: { melee: 3, pierce: 10 }, desc: 'Meydan çeşmesi: güzellik +6, çevresindeki (6 karo) birimler yavaşça iyileşir.',
  },
  cherryTree: {
    name: 'Süs Ağacı', size: 1, hp: 150, cost: { wood: 20, food: 20 }, buildTime: 6, age: 0, decor: true, sprite: 'cherryTree', beauty: 2, fit: 0.8,
    armor: { melee: 0, pierce: 5 }, desc: 'Taş saksıda çiçek açmış kiraz ağacı: meydanları ve yolları süsler.',
  },
  wonder: {
    name: 'Harika', size: 5, hp: 4800, cost: { wood: 1000, gold: 1000, stone: 1000 }, buildTime: 120, age: 3,
    sprite: 'wonder', limit: 1, armor: { melee: 2, pierce: 8 },
    desc: 'Medeniyetinizin en büyük eseri. Tamamlandığında zafer kazanırsınız.',
  },
};

/** Köylünün inşa menüsündeki sıra */
export const BUILD_MENU = ['townCenter', 'house', 'lumberCamp', 'mill', 'miningCamp', 'farm', 'vegetableBed', 'animalFarm', 'greenhouse', 'granary', 'dock', 'waterMill', 'goldPanning', 'wall', 'gate', 'firePit', 'barracks', 'otag', 'archeryRange', 'stable', 'watchTower', 'hospital', 'tavern', 'wineCellar', 'scienceCenter', 'market', 'siegeWorkshop', 'university', 'alchemyLab', 'wonder'];
/** Mimarın süsleme menüsü */
export const DECOR_MENU = ['path', 'hedge', 'flowerBed', 'cherryTree', 'bench', 'lampPost', 'well', 'statue', 'fountain'];

/**
 * Birimler.
 *  attack : hasar      armor: { melee, pierce }      range: 0 = yakın dövüş, > 0 = ok (karo)
 *  reload : saldırı aralığı (sn)      los: görüş mesafesi (otomatik hedef seçimi için)
 *  bldgMul: binalara karşı hasar çarpanı
 */
export const UNITS = {
  villager: {
    name: 'Köylü', cost: { food: 50 }, trainTime: 10, pop: 1, hp: 25, speed: 1.8, carry: 10,
    attack: 3, armor: { melee: 0, pierce: 0 }, range: 0, reload: 2, los: 4, bldgMul: 1, gatherer: true, builder: true, civil: true,
  },
  // Mimar (Üniversite): yalnızca süsleme (patika, çiçek, süs ağacı) kurar, kaynak toplamaz
  architect: {
    name: 'Mimar', cost: { food: 60, gold: 60 }, trainTime: 15, pop: 1, hp: 30, speed: 1.9, carry: 0,
    attack: 1, armor: { melee: 0, pierce: 0 }, range: 0, reload: 2, los: 5, bldgMul: 1, decorBuilder: true, civil: true,
  },
  // Araştırmacı (Üniversite): kendi kamuflajlı arabasıyla seçilen kaynağı haritanın her yerinde arar, bulur, çok yük
  // taşır ve en yakın kabul eden binaya boşaltır; biten kaynağın yerine kendiliğinden yenisini arar. Deri için av yapar.
  // Gizli: düşman birimleri ve kuleleri onu yalnızca 2 karo içinde fark eder (yine de öldürülebilir).
  prospector: {
    name: 'Araştırmacı', cost: { food: 120, wood: 100, gold: 80 }, trainTime: 30, pop: 1, hp: 90, speed: 2.4, carry: 200,
    attack: 4, armor: { melee: 1, pierce: 3 }, range: 0, reload: 1.6, los: 8, bldgMul: 0, gatherer: true, civil: true, gatherMul: 2.5, stealth: true,
  },
  // Yük arabası (İmparatorluk Çağı, Kasaba Merkezi): kaynaktan çok yük alır, YALNIZCA Kasaba Merkezi'ne boşaltır
  cart: {
    name: 'Yük Arabası', cost: { wood: 150, gold: 80 }, trainTime: 25, pop: 1, hp: 140, speed: 2.3, carry: 60, age: 3,
    attack: 0, armor: { melee: 1, pierce: 4 }, range: 0, reload: 2, los: 5, bldgMul: 0, gatherer: true, vehicle: true, civil: true, gatherMul: 1.6, dropTC: true,
  },
  // Komutan: milisle aynı görünür; tek olur (ölürse Kışla'dan yenisi atanır). Yalnız o "Devriye" atabilir.
  commander: {
    name: 'Komutan', cost: { food: 150, gold: 100 }, trainTime: 30, pop: 1, hp: 90, speed: 1.7,
    attack: 8, armor: { melee: 1, pierce: 2 }, range: 0, reload: 2, los: 8, bldgMul: 2, unique: true, patrol: true,
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
  // Mancınık: uzaktan taş atar, isabet noktasında alan hasarı (binalara ×3)
  catapult: {
    name: 'Mancınık', cost: { wood: 250, gold: 150 }, trainTime: 45, pop: 2, hp: 150, speed: 0.85, age: 2,
    attack: 30, armor: { melee: 0, pierce: 6 }, range: 9, reload: 6, los: 10, bldgMul: 3, splash: 1.3, vehicle: true,
  },
  // Savaş Arabası: içine 50 asker alır, yayalardan hızlı; çok pahalı (5000 kaynak) ve uzun sürede üretilir
  warWagon: {
    name: 'Savaş Arabası', cost: { food: 1000, wood: 2000, gold: 1500, stone: 500 }, trainTime: 180, pop: 1, hp: 1400, speed: 2.3, age: 3,
    attack: 0, armor: { melee: 4, pierce: 12 }, range: 0, reload: 2, los: 7, bldgMul: 0, vehicle: true, transport: 50, noAttack: true,
  },
  // Yabani hayvanlar (avlanır: et + deri)
  gazelle: { name: 'Ceylan', cost: {}, trainTime: 0, pop: 0, hp: 6, speed: 2.4, attack: 0, armor: { melee: 0, pierce: 0 }, range: 0, reload: 2, los: 6, bldgMul: 0, animal: true, civil: true, meat: 120, hide: 6, height: 26 },
  deer:    { name: 'Geyik', cost: {}, trainTime: 0, pop: 0, hp: 8, speed: 2.2, attack: 0, armor: { melee: 0, pierce: 0 }, range: 0, reload: 2, los: 6, bldgMul: 0, animal: true, civil: true, meat: 160, hide: 10, height: 33 },
  rabbit:  { name: 'Tavşan', cost: {}, trainTime: 0, pop: 0, hp: 3, speed: 2.0, attack: 0, armor: { melee: 0, pierce: 0 }, range: 0, reload: 2, los: 5, bldgMul: 0, animal: true, civil: true, meat: 40, hide: 2, height: 11 },
  horse:   { name: 'Yaban Atı', cost: {}, trainTime: 0, pop: 0, hp: 10, speed: 2.7, attack: 0, armor: { melee: 0, pierce: 0 }, range: 0, reload: 2, los: 7, bldgMul: 0, animal: true, civil: true, meat: 200, hide: 14, height: 36 },
  fishingBoat: {
    name: 'Balıkçı Teknesi', cost: { wood: 75 }, trainTime: 15, pop: 1, hp: 60, speed: 2.0, carry: 15,
    attack: 0, armor: { melee: 0, pierce: 4 }, range: 0, reload: 2, los: 6, bldgMul: 0, naval: true,
  },
  // Mağaradaki yaratık (Koca Ayak): yalnızca kışın çıkar, herkese saldırır. Surları hızla yıkar (wallMul),
  // binalara karşı yavaştır (bldgMul < 1).
  yeti: {
    name: 'Koca Ayak', cost: {}, trainTime: 0, pop: 0, hp: 2200, speed: 1.3,
    attack: 48, armor: { melee: 2, pierce: 4 }, range: 0, reload: 2.4, los: 8, bldgMul: 1.1, wallMul: 5, monster: true,
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
  fish:  { name: 'Balık Sürüsü',  resType: 'food',  amount: 400 },
  carcass: { name: 'Av Eti',      resType: 'food',  amount: 120 },
  // Tesisler: haritanın birkaç yerinde, 3×3 büyük ve zengin kaynak alanları (birçok köylü aynı anda çalışır)
  quarry:      { name: 'Taş Ocağı Tesisi', resType: 'stone', amount: 3000, size: 3 },
  goldReserve: { name: 'Altın Rezervi',    resType: 'gold',  amount: 3000, size: 3 },
};

/**
 * Teknolojiler.
 *  effect: Player.modifiers üzerine ÇARPAN olarak uygulanır (toplama, taşıma, hız)
 *  bonus : birim türüne EKLENEN değerler  { militia: { attack: 2 } }
 */
export const TECH_CATEGORIES = [
  { id: 'village', name: 'Köy' }, { id: 'army', name: 'Ordu' }, { id: 'health', name: 'Sağlık' }, { id: 'defense', name: 'Savunma' },
];
/**
 * Tüm araştırmalar Bilim Merkezi'nde. cat: başlık · requires: ağaçta önceki düğüm
 *  effect: Player.modifiers çarpanı · add: modifiers'a eklenen değer · bonus: birim türüne eklenen değer
 */
export const TECHS = {
  // ── KÖY ──
  wheelbarrow: { cat: 'village', name: 'El Arabası',     icon: 'wheelbarrow', age: 1, cost: { food: 175, wood: 50 },  time: 20, effect: { carry: 1.3, speed: 1.1 }, desc: 'Köylüler %30 fazla taşır ve %10 hızlı yürür.' },
  handCart:    { cat: 'village', name: 'Kol Arabası',    icon: 'wheelbarrow', age: 2, cost: { food: 250, wood: 150 }, time: 30, effect: { carry: 1.3, speed: 1.1 }, requires: 'wheelbarrow', desc: 'Köylüler %30 daha fazla taşır, %10 daha hızlı yürür.' },
  doubleAxe:   { cat: 'village', name: 'Çift Balta',     icon: 'axe',         age: 1, cost: { food: 100, wood: 50 },  time: 15, effect: { wood: 1.2 },  desc: 'Odun toplama +%20.' },
  bowSaw:      { cat: 'village', name: 'Yay Testere',    icon: 'build',       age: 2, cost: { food: 150, wood: 100 }, time: 20, effect: { wood: 1.2 },  requires: 'doubleAxe', desc: 'Odun toplama +%20.' },
  twoManSaw:   { cat: 'village', name: 'Çift Kişilik Testere', icon: 'build', age: 3, cost: { food: 300, wood: 100 }, time: 30, effect: { wood: 1.15 }, requires: 'bowSaw', desc: 'Odun toplama +%15.' },
  goldMining:  { cat: 'village', name: 'Altın Madenciliği', icon: 'pickaxe',  age: 1, cost: { food: 100, wood: 75 },  time: 15, effect: { gold: 1.15 }, desc: 'Altın toplama +%15.' },
  goldShaft:   { cat: 'village', name: 'Altın Kuyusu',   icon: 'pickaxe',     age: 2, cost: { food: 200, wood: 150 }, time: 25, effect: { gold: 1.15 }, requires: 'goldMining', desc: 'Altın toplama +%15.' },
  stoneMining: { cat: 'village', name: 'Taş Madenciliği', icon: 'stone',      age: 1, cost: { food: 100, wood: 75 },  time: 15, effect: { stone: 1.15 }, desc: 'Taş toplama +%15.' },
  stoneShaft:  { cat: 'village', name: 'Taş Kuyusu',     icon: 'stone',       age: 2, cost: { food: 200, wood: 150 }, time: 25, effect: { stone: 1.15 }, requires: 'stoneMining', desc: 'Taş toplama +%15.' },
  horseCollar: { cat: 'village', name: 'At Koşumu',      icon: 'horseCollar', age: 1, cost: { food: 75, wood: 75 },   time: 15, effect: { farm: 1.25 }, desc: 'Çiftlik verimi +%25.' },
  heavyPlow:   { cat: 'village', name: 'Ağır Saban',     icon: 'horseCollar', age: 2, cost: { food: 125, wood: 125 }, time: 25, effect: { farm: 1.2 }, requires: 'horseCollar', desc: 'Çiftlik verimi +%20.' },
  cropRotation:{ cat: 'village', name: 'Münavebe',       icon: 'food',        age: 3, cost: { food: 250, wood: 250 }, time: 35, effect: { farm: 1.2 }, requires: 'heavyPlow', desc: 'Çiftlik verimi +%20.' },
  fishNets:    { cat: 'village', name: 'Balık Ağları',   icon: 'food',        age: 1, cost: { food: 100, wood: 100 }, time: 20, effect: { fish: 1.5 }, desc: 'Balıkçı tekneleri %50 hızlı toplar.' },
  bigNets:     { cat: 'village', name: 'Trol Ağları',    icon: 'food',        age: 2, cost: { food: 200, wood: 200 }, time: 30, effect: { fish: 1.3 }, requires: 'fishNets', desc: 'Balıkçılık +%30.' },
  dairy:       { cat: 'village', name: 'Süt Ürünleri',   icon: 'food',        age: 2, cost: { food: 150, gold: 100 }, time: 25, effect: { ranch: 1.5 }, desc: 'Hayvan çiftliklerinin geliri +%50 (peynir ve tereyağı).' },
  // ── ORDU ──
  longSword:   { cat: 'army', name: 'Uzun Kılıç',        icon: 'swords',      age: 1, cost: { food: 100, gold: 40 },  time: 20, bonus: { militia: { attack: 3, hp: 15 } }, desc: 'Milis: +3 saldırı, +15 can.' },
  twoHanded:   { cat: 'army', name: 'İki Elli Kılıç',    icon: 'swords',      age: 2, cost: { food: 200, gold: 100 }, time: 30, bonus: { militia: { attack: 3, hp: 10 } }, requires: 'longSword', desc: 'Milis: +3 saldırı, +10 can.' },
  scaleArmor:  { cat: 'army', name: 'Pul Zırh',          icon: 'shield',      age: 1, cost: { food: 100, gold: 60 },  time: 25, bonus: { militia: { melee: 1, pierce: 1 }, archer: { melee: 1, pierce: 1 } }, desc: 'Piyade ve okçu: +1 / +1 zırh.' },
  chainMail:   { cat: 'army', name: 'Zincir Zırh',       icon: 'shield',      age: 2, cost: { food: 200, gold: 100 }, time: 30, bonus: { militia: { melee: 1, pierce: 2 }, archer: { melee: 1, pierce: 1 }, cavalry: { melee: 1, pierce: 1 } }, requires: 'scaleArmor', desc: 'Tüm askerler: ek zırh.' },
  fletching:   { cat: 'army', name: 'Talimli Okçular',   icon: 'quiver',      age: 1, cost: { food: 100, wood: 50 },  time: 20, bonus: { archer: { attack: 1, range: 1 }, tower: { attack: 1, range: 1 } }, desc: 'Okçular ve kuleler: +1 saldırı, +1 menzil.' },
  bodkin:      { cat: 'army', name: 'Delici Ok Ucu',     icon: 'quiver',      age: 2, cost: { food: 200, gold: 100 }, time: 30, bonus: { archer: { attack: 1, range: 1 }, tower: { attack: 1, range: 1 } }, requires: 'fletching', desc: 'Okçular ve kuleler: +1 saldırı, +1 menzil.' },
  bloodlines:  { cat: 'army', name: 'Soy Atlar',         icon: 'horseCollar', age: 1, cost: { food: 150, gold: 100 }, time: 25, bonus: { cavalry: { hp: 20 } }, desc: 'Atlılar: +20 can.' },
  husbandry:   { cat: 'army', name: 'Hayvan Bakımı',     icon: 'horseCollar', age: 2, cost: { food: 150 },             time: 25, bonus: { cavalry: { speed: 0.35 } }, requires: 'bloodlines', desc: 'Atlılar %13 daha hızlı.' },
  siegeEng:    { cat: 'army', name: 'Kuşatma Mühendisliği', icon: 'build',    age: 3, cost: { food: 300, wood: 200 }, time: 35, bonus: { ram: { attack: 2, hp: 60 } }, desc: 'Koçbaşı: +2 saldırı, +60 can.' },
  // ── SAĞLIK ──
  herbal:      { cat: 'health', name: 'Şifalı Otlar',    icon: 'food',        age: 0, cost: { food: 100, gold: 25 },  time: 20, add: { regen: 0.25 }, desc: 'Savaşmayan birimler yavaşça iyileşir (saniyede 0,25 can).' },
  infirmary:   { cat: 'health', name: 'Şifahane',        icon: 'food',        age: 2, cost: { food: 200, gold: 100 }, time: 30, add: { regen: 0.5 }, requires: 'herbal', desc: 'İyileşme saniyede +0,5 can artar.' },
  medicine:    { cat: 'health', name: 'Tıp Okulu',       icon: 'banner',      age: 3, cost: { food: 300, gold: 200 }, time: 40, bonus: { villager: { hp: 5 }, militia: { hp: 10 }, archer: { hp: 8 }, cavalry: { hp: 15 } }, requires: 'infirmary', desc: 'Tüm birimler: daha fazla can.' },
  cleanWater:  { cat: 'health', name: 'Temiz Su',        icon: 'food',        age: 1, cost: { food: 100, wood: 50 },  time: 20, bonus: { villager: { hp: 10 } }, effect: { speed: 1.05 }, desc: 'Köylüler: +10 can, %5 hızlı.' },
  nutrition:   { cat: 'health', name: 'Dengeli Beslenme', icon: 'food',       age: 2, cost: { food: 200, gold: 50 },  time: 25, effect: { food: 1.05, wood: 1.05, gold: 1.05, stone: 1.05, farm: 1.05 }, requires: 'cleanWater', desc: 'Tüm kaynak toplama +%5.' },
  // ── SAVUNMA ──
  masonry:     { cat: 'defense', name: 'Duvarcılık',     icon: 'stone',       age: 1, cost: { wood: 150, stone: 100 }, time: 30, effect: { bldgHp: 1.2 }, desc: 'Tüm binalar +%20 can.' },
  architecture:{ cat: 'defense', name: 'Mimarlık',       icon: 'build',       age: 3, cost: { wood: 300, stone: 200 }, time: 40, effect: { bldgHp: 1.2 }, requires: 'masonry', desc: 'Tüm binalar +%20 can.' },
  furClothes:  { cat: 'health', name: 'Kürk Giysiler',  icon: 'it_hide',     age: 1, cost: { hide: 60, food: 100 },  time: 25, add: { winterProof: 1 }, desc: 'Deriden kışlık giysi: kışın toplama yavaşlamaz ve halkın huzuru düşmez.' },
  leatherArmor:{ cat: 'army', name: 'Deri Zırh',         icon: 'it_hide',     age: 1, cost: { hide: 100, gold: 50 },  time: 25, bonus: { militia: { melee: 1, pierce: 1 }, archer: { melee: 1, pierce: 1 }, cavalry: { melee: 1, pierce: 1 } }, desc: 'Askerler: deriden zırh, +1 / +1.' },
  hunting:     { cat: 'village', name: 'Avcılık',        icon: 'it_hide',     age: 0, cost: { food: 80, wood: 40 },   time: 15, add: { huntBonus: 0.5 }, desc: 'Avlanan hayvandan %50 fazla et ve deri.' },
  murderHoles: { cat: 'defense', name: 'Mazgal Delikleri', icon: 'quiver',    age: 2, cost: { food: 200, stone: 100 }, time: 30, bonus: { tower: { attack: 2 } }, desc: 'Kuleler ve Kasaba Merkezi: +2 ok hasarı.' },
};

/**
 * Üretim binası seviyeleri (1 → MAX_LEVEL). Seviye başına üretim +%25:
 *   kamp/değirmen: bırakılan kaynak · çiftlik: toplama hızı ve yiyecek kapasitesi · tersane: balıkçı geliri ve bırakılan balık
 * Yükseltme bedeli = bina maliyeti × costMul × mevcut seviye + altın; süresi time × seviye.
 */
/**
 * SEVİYELER (1–100): kaynak toplayan / işleyen yapılar. Her seviye üretimi ve kapasiteyi %5 artırır (seviye 100'de ×5,95).
 * Bedel: yapının maliyeti × costMul × seviye + altın × seviye · süre: time + timePer × seviye (sn)
 */
export const LEVELS = { MAX_LEVEL: 100, bonus: 0.05, costMul: 0.4, gold: 15, time: 8, timePer: 1.5 };

/** Mağara ve yaratık: kış başladıktan `delay` sn sonra çıkar; saldırdığı köyü yok edene kadar durmaz */
export const WILD_DEF = { delay: 25, reward: { food: 500, gold: 300 } };

/**
 * SİMYA (Simya Atölyesi): iksirler envantere eklenir (kullanılınca etki eder), aletler kalıcıdır (bir kez üretilir).
 *  dur: etki süresi (sn)
 */
export const ITEMS = {
  stoneSkin:  { name: 'Taş Deri İksiri',   kind: 'potion', icon: 'it_shield',  cost: { gold: 150, food: 100 }, time: 25, dur: 60, desc: 'İçilince 1 dakika boyunca binalarınız hiç hasar almaz.' },
  swift:      { name: 'Rüzgâr İksiri',     kind: 'potion', icon: 'it_swift',   cost: { gold: 100, food: 100 }, time: 20, dur: 60, desc: '1 dakika boyunca tüm birimleriniz %40 hızlı.' },
  strength:   { name: 'Güç İksiri',        kind: 'potion', icon: 'it_power',   cost: { gold: 150, food: 80 },  time: 25, dur: 60, desc: '1 dakika boyunca askerlerinizin saldırısı +%50.' },
  heal:       { name: 'Şifa İksiri',       kind: 'potion', icon: 'it_heal',    cost: { gold: 80, food: 120 },  time: 20, desc: 'Tüm birimleriniz anında tamamen iyileşir.' },
  vision:     { name: 'Kartal Gözü İksiri', kind: 'potion', icon: 'it_vision', cost: { gold: 120 },            time: 20, desc: 'Haritanın tamamı keşfedilir (düşman üssü, tesisler, mağara).' },
  fertilizer: { name: 'Bereket Tozu',      kind: 'potion', icon: 'it_dust',    cost: { gold: 60, wood: 60 },   time: 15, desc: 'Tüm çiftliklerinize anında +150 yiyecek.' },
  basket:     { name: 'Hasır Sepet',       kind: 'tool',   icon: 'it_basket',  cost: { wood: 150, gold: 50 },  time: 30, effect: { carry: 1.25 }, desc: 'Kalıcı alet: köylüler %25 fazla taşır.' },
  steelPick:  { name: 'Çelik Kazma',       kind: 'tool',   icon: 'it_pick',    cost: { gold: 100, stone: 100 }, time: 30, effect: { gold: 1.2, stone: 1.2 }, desc: 'Kalıcı alet: altın ve taş toplama +%20.' },
  lightBoots: { name: 'Hafif Çizme',       kind: 'tool',   icon: 'it_swift',   cost: { food: 100, gold: 60 },  time: 25, effect: { speed: 1.1 }, desc: 'Kalıcı alet: köylüler %10 hızlı yürür.' },
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
  defenders: { militia: 4, archer: 2 },
  ageAt: [0, 420, 900, 1500], // en erken çağ atlama zamanı (sn); bedeli oyuncu gibi öder
  minDistance: 100,
};

/**
 * Zorluk: düşman dalgalarının zamanı/büyüklüğü ve düşman köylülerinin toplama hızı.
 * Başlangıç kaynakları her zorlukta aynıdır (START).
 */
export const DIFFICULTY = {
  // firstWave: ilk saldırının en erken zamanı (sn) — üstüne 0–2 dk rastgele eklenir.
  // interval : dalgalar arası ORTALAMA süre; her seferinde %60–%150 arası rastgele (saldırı zamanı tahmin edilemez).
  // enemyGather: düşman köylülerinin toplama çarpanı (normalde sizden %5 hızlı)
  // enemyStart: düşmanın başlangıç hazinesi (her kaynaktan)
  // Düşman sizinle AYNI başlar (aynı bina, kaynak, köylü) ve aynı kurallarla oynar; zorluk yalnızca ne kadar
  // ACELECİ saldırdığını belirler (ilk saldırı ve dalga aralığı). Saldırılar kendi ürettiği orduyla yapılır.
  easy:   { name: 'Kolay', firstWave: 720, interval: 240, enemyGather: 1, enemyVillagers: 3 },
  normal: { name: 'Normal', firstWave: 540, interval: 180, enemyGather: 1, enemyVillagers: 3 },
  hard:   { name: 'Zor', firstWave: 420, interval: 130, enemyGather: 1, enemyVillagers: 3 },
};

/**
 * HUZUR (0–100): toplama hızını etkiler (×0,8 … ×1,2).
 * Artıran: evler, nüfus, güzellik (süsler), tavernalar (şarapla). Azaltan: savaş, kayıplar, açlık, kış (kürksüz).
 */
export const HAPPINESS = { start: 60, base: 45, perHouse: 1.5, maxHouse: 15, perPop: 0.2, maxPop: 10, perBeauty: 0.6, maxBeauty: 20, maxTavern: 21, war: 15, starving: 25, winter: 8 };

/** Gıda tüketimi (birim başına, saniyede): köylü ~0,7, asker ~1,2 yiyecek/dk. Kışın %30 fazla (ambar varsa %10). */
export const UPKEEP = { civil: 0.012, military: 0.02, winter: 1.3, winterGranary: 1.1 };

/** Yağma: düşman bir binanızı yıkınca korunmayan kaynakların bu oranı çalınır */
export const PLUNDER = 0.08;

export const START = {
  resources: { food: 1000, wood: 1000, gold: 1000, stone: 1000, hide: 100 }, // oyuncu ve düşman aynı
  villagers: 3,
  popMax: 200,
};

export function formatCost(cost) {
  return Object.entries(cost).map(([k, v]) => `${v} ${RESOURCE_NAMES[k]}`).join(', ');
}
