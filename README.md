# Arzu'nun Köyü – İzometrik RTS (v3)

HTML5 Canvas + Vanilla JavaScript (ES6 modülleri) ile yazılmış, Age of Empires tarzı izometrik gerçek zamanlı strateji oyunu.
Harici kütüphane yoktur. Grafikler ve ses efektleri bu proje için yapay zekâ ile üretilmiş, `tools/` içindeki betiklerle oyuna hazırlanmıştır.

## Çalıştırma

Tarayıcılar ES modüllerini ve görselleri dosyadan (`file://`) açmaya izin vermez; oyun yerel bir sunucu üzerinden açılmalıdır.

**En kolay yol**
- **Windows:** `baslat.bat` dosyasına çift tıklayın. Python veya Node.js varsa onu kullanır; ikisi de yoksa Windows'ta yerleşik
  PowerShell ile bağımlılıksız bir sunucu açar. Tarayıcı kendiliğinden `http://localhost:8080` adresinde açılır.
- **macOS / Linux:** `sh baslat.sh`

**Visual Studio / IIS Express:** Klasördeki `web.config`, IIS Express'in varsayılan olarak sunmadığı `.webp` ve `.mp3` türlerini
tanımlar. Projeyi **bu klasör kök olacak şekilde** açın (Dosya → Aç → Web Sitesi / Klasör). "Görsel yüklenemedi: ….webp"
hatası alırsanız `web.config` dosyasının proje kökünde olduğundan emin olun veya `baslat.bat` kullanın.

**VS Code:** "Live Server" eklentisiyle `index.html` → "Open with Live Server".

**Elle:** `python tools/stamp.py` ardından `python tools/server.py` veya `npx serve -l 8080 .`

**Önbellek:** `baslat.bat`/`baslat.sh` her açılışta `tools/stamp.py`'yi çalıştırır: her JavaScript dosyasına içerik özetinden
bir sürüm verilir (`index.html` içindeki import map) ve görsel/ses adreslerine `?v=` eklenir. Böylece oyun güncellenince
tarayıcı eski dosyaları kullanamaz (eski ve yeni dosyaların karışması örneğin teknelerin karadan yol bulmaya çalışıp
yerinde kalmasına yol açıyordu). `tools/server.py` hem IPv4 hem IPv6 dinler: Windows'ta `localhost`'un IPv6 denemesindeki
bağlantı başına ~2 sn gecikme olmaz (130 görsel 10+ sn yerine ~1 sn'de yüklenir).

**Sürümler:** `VERSION` dosyası ve git etiketleri (`v1.0.0`, `v1.1.0`, …).

## Oynanış

- **Ana menü:** Devam Et (en son kayıt) · Yeni Oyun (zorluk Kolay/Normal/Zor, Klasik veya Rastgele harita, savaş sisi) ·
  Kayıtlı Oyunu Yükle · Ayarlar · Nasıl Oynanır. Oyun içinde **Esc/F10/P** veya üst bardaki ☰ duraklatır
  (Devam · Kaydet · Yükle · Ayarlar · Ana Menü). **F5** hızlı kayıt; ayarlarda açıksa 2 dakikada bir otomatik kayıt.
- **Ayarlar:** grafik kalitesi (Düşük/Orta/Yüksek: çözünürlük, su ve parçacık kalitesi), hava efektleri, canlılık,
  otomatik kayıt, FPS göstergesi ve dört ses seviyesi (ana, müzik, atmosfer, efektler). Değişiklikler anında uygulanır.
- **Ekonomi:** Köylüler odun, yiyecek (meyve/çiftlik), altın ve taş toplar; 10 birim dolunca en yakın uygun binaya bırakır.
- **Başlangıç:** 5000 yiyecek · 5000 odun · 5000 altın · 5000 taş ve 3 köylü.
- **Kaynak verimi:** Üst bardaki bir kaynağın üzerine gelince **saatlik çıkarım** (son 5 dakikanın ortalaması, oyun
  süresi), dakikalık hız, o kaynağı toplayan köylü/tekne sayısı, tersane geliri ve toplam toplanan miktar görünür.
- **Binalar:** Ev · Kereste Kampı · Değirmen (kanatları döner) · Maden Kampı · Çiftlik · **Tersane** · **Ahşap Çit** ·
  **Kapı** · **Ateş Çukuru** · **Kışla** · **Okçuluk Alanı** (Feodal) · **Ahır** (Feodal) · **Gözetleme Kulesi** (Feodal) ·
  **Kuşatma Atölyesi** (Kale) · Pazar (Feodal) · Harika (İmparatorluk).
- **Tersane ve balıkçılık:** Yalnızca köylüler kurabilir ve yalnızca su kenarına yerleşir. **Balıkçı teknesi** üretir;
  tekne kendi gölündeki en yakın **balık sürüsüne** gider, ağ atar ve dolunca tersaneye boşaltır (her su kütlesi ayrı
  numaralanır, tekne başka göle gitmeye çalışmaz). Köylüler kıyıdaki balık sürüsünden de balık tutabilir.
  **Balık Ağları** (Feodal) tekneleri %50 hızlandırır. Tersanenin gölünde balık yoksa uyarı çıkar.
- **Bina seviyeleri:** Çiftlik, Kereste Kampı, Değirmen, Maden Kampı ve Tersane seçiliyken **Seviye 2 / 3** ile
  yükseltilir (bedel: bina maliyeti × 1,5 × seviye + 60 × seviye altın; süre 20 sn × seviye). Her seviye üretimi %25
  artırır: kamp/değirmene bırakılan kaynak artar, çiftlik daha hızlı ürün verir ve yiyeceği tazelenir, tersanede
  balıkçı geliri ve teknelerin getirdiği balık artar. Seviye, seçim panelinde "Sv. 2" olarak görünür.
- **Yarım inşaatı yık:** Tamamlanmamış kendi inşaatınızı seçince **İnşaatı Yık** düğmesi çıkar; inşaat kaldırılır ve
  maliyetin **yarısı** geri verilir (tamamı değil).
- **Ateş Çukuru:** Köylüler kurar (30 odun, 10 taş). Gece köylüler ateşi yakar, başında iki köylü ısınır; çevresi geniş ve
  merkezde daha parlak iki ışık halkasıyla diğer yerlerden belirgin şekilde aydınlık olur.
- **Alevler:** Tüm ateşlerin (kamp ateşi, ateş çukuru, yanan binalar, ev ışıkları) parlaklığı mum alevi gibi **yavaş ve
  rastgele** büyüyüp küçülür (sinüsün düzenli nabzı yerine yumuşak gürültü).
- **Çit ve kapı:** Çit seçiliyken başlangıç karosundan bitişe **sürükleyin**; hat 4-komşulu çizilir (delik kalmaz),
  geçersiz karolar atlanır. Köylüler parçaları sırayla kurar. **Kapı** yalnızca sizin birimlerinizi geçirir.
  Düşman askerleri yol kapalıysa çiti/kapıyı **kırarak** geçer.
- **Surlar çağla değişir:** Karanlık Çağ'da **Ahşap Çit** (300 can, 3 odun), Feodal'de **Taş Sur** (1100 can, zırh 6/10,
  5 taş), Kale/İmparatorluk'ta daha kalın ve yüksek **Kale Suru** (2600 can, zırh 10/14, 8 taş). Kapı da Ahşap → Taş →
  Kale Kapısı olur. Çağ atlayınca mevcut surlar ve kapılar da yeni kademeye geçer (hasarlıysa can oranı korunur);
  görünüm, kalınlık ve sağlamlık birlikte değişir.
- **Tamir:** Köylüleri seçip hasarlı kendi binanıza sağ tıklayın ya da binayı seçip **Tamir Ettir**'e basın (en yakın
  4 köylü gelir). Tamir, onarılan cana orantılı olarak bina maliyetinin yarısı oranında kaynak harcar.
- **Köylüleri Çağır:** Kasaba Merkezi (15) ve Gözetleme Kulesi (5) seçiliyken köylüler çanla çağrılır ve içeri sığınır:
  saldırıdan korunur, yavaşça iyileşir; her 3 köylü binaya bir ok daha attırır. **Herkes Dışarı** ile işlerine dönerler.
- **Hasar:** Tamamlanmış bina hasar aldıkça üzerinde alevler ve duman çıkar (alevler binanın kendi görselinin
  dolu piksellerine yerleşir, sayısı hasarla 1'den 7'ye çıkar). İnşaat halindeki bina tek, statik bir iskele görselidir.
- **Gece / gündüz:** Saat sunucudan (HTTP `Date` başlığı) alınır. 16:00'da hava kararmaya başlar, 17:15'ten 06:15'e
  kadar gecedir: ışık sızan evler ve Kasaba Merkezi yanındaki kamp ateşinin başında kupalarından içen askerler.
  **Dolunay** gökyüzünün en tepesinde gece boyunca soldan sağa yay çizerek ilerler, gün ağarınca kaybolur.
  Üst bardaki saat düğmesi veya **L**: Otomatik → Gece → Gündüz.
- **Bekleyen inşaatlar:** Sağ üstteki listede her inşaatın yüzdesi ve işçi sayısı görünür; tıklayınca kamera binaya gider.
  Başlıktaki ok düğmesi listeyi **gizler/gösterir** (tercih hatırlanır).
- **Köylü düğmesi:** Üst bardaki köylü düğmesinin üzerine gelince yazısız üç ikon açılır (açıklaması fare ile üzerine
  gelince çıkar): **boştaki tüm köylüleri seç**, **tüm köylüleri seç**, **boştaki bir köylüyü seç** (kamerayı ona götürür).
- **Çağlar:** Karanlık → Feodal → Kale → İmparatorluk; binaların görünümü her çağda değişir.
- **Savaş**
  - **Milis** (yakın dövüş, binalara ×3 hasar), **Okçu** (menzilli; oklar kavisli yörüngede uçar), **Atlı Keşifçi**
    (Ahır; çok hızlı, +20 can için Soy Atlar) ve **Koçbaşı** (Kuşatma Atölyesi; yalnızca binalara saldırır, binalara
    ×30 hasar, oklara neredeyse dayanıklı).
  - Hasar = max(1, saldırı − zırh); yakın dövüş ve ok zırhı ayrı. Teknolojiler: Uzun Kılıç, Pul Zırh, Talimli Okçular.
  - Askerler görüş alanındaki düşmanla kendiliğinden savaşır; saldırıya uğrayan boştaki birim karşılık verir.
  - **Otomatik savaş:** Bir askerin yanına düşman gelip çatışma başlayınca 7 karo içindeki boştaki/nöbetteki müttefik
    askerler de savaşa katılır (sizin ve düşmanın askerleri için).
  - **Düşman hedef önceliği:** Düşman askerleri (ve yaratık) her zaman önce **surları/kapıları**, sonra **askerleri**,
    sonra **köylüleri**, en son diğer binaları hedefler.
  - Kasaba Merkezi ve kuleler menzile giren düşmana ok atar. Hasar alan binalar yanar; yıkılan binanın yerinde yıkıntı kalır.
- **Düşman (kırmızı):** Haritanın uzak ama karadan ulaşılabilir bir köşesinde üs kurar (Kasaba Merkezi, Kışla, Okçuluk Alanı,
  2 kule, nöbetçiler). **Ekonomisi vardır:** köylüleri üssün çevresinde kaynak toplar, düşman zamanla yeni köylü yetiştirir
  ve biriken kaynakla her dalgaya ek asker satın alır → düşman köylülerine baskın yapmak dalgaları küçültür.
  **İlk 20 dakika asla saldırı olmaz**; ilk saldırı 20–25 dk (Kolay 25–30 dk) arasında rastgele bir anda gelir, sonraki
  saldırılar da rastgele aralıklarla (ortalama Kolay 5 / Normal 4 / Zor 3 dk, her seferinde %60–%150) gelir. Saldırı
  zamanı önceden gösterilmez; saldırı başlayınca savaş borusu ve uyarı çıkar. Zorluk ayrıca dalga büyüklüğünü, düşman
  köylü sayısını ve toplama hızını belirler. Düşman zamanla çağ atlar ve güçlenir.
- **Mağara ve Koca Ayak:** Haritanın rastgele ama hem size hem düşmana uzak bir yerinde bir **mağara** vardır. Mevsim
  döngüsü 30 dakikadır ve yaratık **yalnızca kışın** (yani 30 dakikada bir) dışarı çıkar: kış başlayınca ~25 sn sonra
  uyanır, rastgele bir tarafın üssüne saldırır, 140 sn sonra diğer tarafa yönelir — **hem size hem düşmana** saldırır.
  Surları hızla yıkar (sura karşı ×4,5 hasar) ama diğer binaları yavaş yıkar (×0,45). Kış bitince mağarasına döner.
  1500 canı vardır; öldüren taraf 400 yiyecek + 200 altın kazanır, sonraki kış yeni bir yaratık uyanır.
- **Savaş sisi:** Keşfedilmemiş alanlar karanlıktır. Keşfettiğiniz yerler açık kalır (yalnızca hafif gölgeli), ama oradan
  geçen düşman birimleri yalnızca görüş alanınızdaysa görünür (minimap dahil). Görüş geniştir: birim görüşünün 1,5 katı
  + 3 karo, Kasaba Merkezi 15 karo. Gece görüş biraz kısalır. Yeni oyunda kapatılabilir.
- **Harita:** 160×160 karo. Başlangıç kaynakları (meyve, orman, altın, taş) üsse yakın ama farklı yönlerde; haritaya
  dağılan kümeler alanla orantılıdır ve birbirinden uzaktır (aynı tür en az 22, farklı tür en az 8 karo).
- **Görünüm:** Binalar, ağaçlar ve dağlar arkalarındaki birimlerin ve tavukların ÖNÜNDE çizilir (ayak izine göre derinlik).
  Örtülen kendi birimleriniz soluk siluetle görünür, düşman tamamen gizlenir.
- **Mevsimler ve hava:** İlkbahar → Yaz → Sonbahar → Kış (her biri 7,5 dakika; oyun yazla başlar). Sonbaharda meşeler
  kızıla döner. **Kışın her yer beyaza bürünür:** zemin ~40 sn içinde karla kaplanır (göller açık kalır, kıyılar buzlu
  görünür), ağaçlar, çalılar, dağlar, madenler ve bina çatıları karlı görünüme geçer, mini harita da beyazlar;
  ilkbaharda kar aynı hızla erir. Kar yağışı kışın daha sık olur; **kışın çiftlikler %25 yavaş, ilkbaharda %10 hızlı**. Her mevsimin kendi hava
  olasılıkları vardır: yağmur (hava kararır, yağmur sesi), kar (rüzgâr sesi), sis.
- **Canlılık:** gündüz kuş sürüleri (yerde gölgeleri kayar), Kasaba Merkezi çevresinde gezinip yem gagalayan tavuklar,
  balık sürülerinin su altı gölgeleri, ara sıra sudan sıçrayan balıklar, ev ve atölyelerin bacalarından duman.
- **Zafer:** Düşman Kasaba Merkezi'ni yıkın veya Harika inşa edin. **Yenilgi:** Kasaba Merkeziniz yıkılırsa.
- **Ses (üç kanal + ana ses):** **Müzik** (köy teması; çatışma başlayınca savaş temasına çapraz geçiş),
  **Atmosfer** (gündüz kuşlar ↔ gece cırcır böcekleri karanlığa göre; yağmur ve kış rüzgârı havaya göre; kamp ateşi
  çıtırtısı kameranın ateşe uzaklığına göre) ve **Efektler** (balta, kazma, çekiç, kılıç, ok, ölüm, bina çökmesi, çan,
  fanfar, savaş borusu, koçbaşı, ağ, balık, tavuk). Üst bardaki üç düğme (veya **B**, **N**, **M**) ayrı ayrı açıp kapatır.
  Efektler konumsaldır (ekrandaki yere göre sola/sağa, ekran dışında uzaklığa göre kısılır).
- **Animasyon:** Köylü (yürüme, odun taşıma, balta, kazma, çekiç, hasat), milis (yürüme, kılıç), okçu (yürüme, ok atma)
  ve atlı (tırıs, kılıç) 12–16 karelik akıcı döngülerle oynar; köylü, milis, okçu ve atlının **ölüm animasyonu** vardır.
  Tekne dalgada sallanır ve iz bırakır, ölünce batar; koçbaşı tekerlek üstünde yalpalar, vururken öne atılır (ikisi de
  8 yönlü görselle). Birimler birbirini iter (üst üste binmez). Yürüyüş **8 yönlüdür**: sağ, sağ-aşağı, aşağı, sağ-yukarı ve yukarı için ayrı
  animasyonlar vardır, sol yönler bunların aynasıdır. Yön, yumuşatılmış hareket vektöründen ve titremeyi önleyen bir
  eşik payıyla seçilir. Yürüyüş karesi alınan yola bağlıdır (ayak kayması yok); iş sesleri aletin değdiği karede,
  saldırı vuruşu hasar anında çalar.

## Kontroller

| Girdi | Eylem |
|---|---|
| Sol tık / sürükle | Seç / kutu seçimi (yalnızca kendi birimleriniz) · Çift tık: ekrandaki aynı türden birimler |
| Sağ tık | Topla / inşa et / bırak / yürü · **düşmana: saldır** · binada toplanma noktası |
| Orta tuş veya Space + sol sürükle | Haritayı kaydır · WASD / Oklar · Tekerlek: imlece zoom |
| Minimap sol / sağ tık | Kamerayı taşı / seçili birimleri gönder |
| Seçim yap · Alt menünün sekmesi veya **F2** | Alt menü seçim yapınca kendiliğinden açılır, seçim kalkınca kapanır · sekme/F2 sabit açık tutar (hatırlanır). Mini harita sağ altta ayrı ve hep görünür |
| Atmosfer butonu veya **N** · Efektler butonu veya **M** | Atmosfer / olay seslerini aç-kapat (tercih hatırlanır) |
| X veya F1 · L | Kontroller penceresi · Gece/gündüz modu |
| **Ctrl+1…9** · **1…9** (iki kez) | Seçimi gruba kaydet · grubu seç (iki kez: kamera gruba gider) · Shift+rakam: gruba ekle |
| **Q E R T Y U I O F C V Z J K** | Görünen komut butonları sırasıyla (harf butonun sol üst köşesinde) |
| **Esc / F10 / P** · **F5** · **B** | Menü ve duraklatma · hızlı kayıt · müzik aç-kapat |
| H · . · Esc · G · F1 · F3 | Kasaba Merkezi · Boşta köylü · İptal · Grid · Yardım · Performans |

## Mimari

```
js/
├── main.js                 Yükleme ekranı → AssetLoader → Game
├── config.js               Motor sabitleri
├── data/gameData.js        Oyun dengesi: çağlar, binalar, birimler, teknolojiler, düşman ayarları (data-driven)
├── data/animData.js        Animasyon zamanlaması: adım uzunluğu, iş döngüsü süresi, vuruş anı
├── core/
│   ├── Game.js             Kompozisyon kökü: seçim, komutlar, yerleştirme, ses/uyarı olayları, döngü (20 Hz sabit adım)
│   └── InputHandler.js     Pointer/Wheel/Keyboard → RTS niyetleri
├── systems/
│   ├── World.js            Oyun kuralları + savaş (hasar, oklar, bina saldırıları, ölüm, zafer/yenilgi)
│   ├── EnemyAI.js          Düşman üssü (erişilebilirlik garantili), ekonomi, dalgalar (hazineden ek asker), çağ atlama
│   ├── Player.js           Kaynaklar, nüfus, çağ, ekonomi çarpanları, birim bonusları (her oyuncu için)
│   ├── Pathfinder.js       A* (8 yön, köşe kesme yok, ikili yığın, karo başına geçiş maliyeti: kapı, çit kırma, su)
│   ├── SpatialGrid.js      Mekânsal ızgara: yakın düşman / kule hedefi / itme sorguları
│   ├── Fog.js              Savaş sisi (keşfedilmiş / görünür ızgaralar + yumuşak sis görüntüsü)
│   ├── Weather.js          Mevsimler ve hava durumu
│   ├── DayNight.js         Sunucu saatine göre gece/gündüz
│   ├── SaveGame.js         Kayıt / yükleme (tohumdan harita + değişiklikler)
│   └── Settings.js         Oyuncu ayarları (kalite, efektler, ses seviyeleri)
├── entities/
│   ├── Unit.js             Ortak birim tabanı: yol takibi, yön, saldırı/kovalama döngüsü
│   ├── Villager.js         Ekonomi durum makinesi (topla / taşı / inşa et / saldır)
│   ├── Soldier.js          Savaş durum makinesi (hazır / yürü / saldır / saldırı yürüyüşü / nöbet); atlı, koçbaşı
│   ├── Boat.js             Balıkçı teknesi (suda yol bulma, balık topla / tersaneye boşalt)
│   └── Building.js         İnşaat, can, üretim kuyruğu, toplanma noktası
├── world/                  Harita üretimi, zemin tipleri, gürültü
├── render/
│   ├── Renderer.js         Katmanlı render + önbellek + genel bakış + şeritli arka tampon; sis, mevsim, hava, gece
│   ├── Ambient.js          Canlılık: kuşlar, tavuklar, balık sürüleri ve sıçramalar, baca dumanı
│   ├── WaterRenderer.js    Maske tabanlı dinamik su
│   ├── SpriteFactory.js    Sprite'lar (mipmap + alfa maskesi), takım rengi dönüşümü (mavi → kırmızı)
│   ├── AssetLoader.js      Paralel yükleme + anlaşılır hata teşhisi (HTTP durum kodu, IIS/.webp)
│   ├── Camera.js, iso.js
├── audio/AudioManager.js   Web Audio: iki kanal (atmosfer / efekt), konumsal ses, ses enflasyonu koruması
└── ui/                     UIManager (üst bar, alt panel, kısayollar), Menu (ana menü, duraklatma, ayarlar), Minimap
assets/                     Sprite'lar (WebP), animasyon şeritleri (anims/), ikonlar, dokular, sesler (MP3), manifest.js
tools/                      slice_sprites.py, process_audio.py, process_anim.py, key_sprite.py + ham varlıklar
web.config · baslat.bat · baslat.ps1 · baslat.sh
```

**Takım rengi:** Düşman sprite'ları ayrı çizilmez. Açılışta mavi tonlu pikseller (ton 190°–260°) HSV uzayında kırmızıya döndürülür;
doygunluk ve parlaklık korunduğu için gölgelendirme ve doku detayı aynen kalır.

## Varlık hattı

```bash
python tools/process_audio.py tools/raw/sounds assets/sounds   # ffmpeg + numpy: kırp, sönümle, seviyeyi eşitle → MP3
python tools/slice_sprites.py                                  # pillow + numpy + scipy: sayfaları böl → WebP + manifest.js
python tools/process_anim.py                                   # opencv + pillow: videolar → animasyon şeritleri (manifest "anims")
python tools/key_sprite.py tools/raw/dock.png dock_0 640       # macenta zeminli görsel → sprite + manifest (en büyük boyut)
python tools/process_audio2.py                                 # imageio-ffmpeg + numpy: ek sesler → seviye eşitleme, kesintisiz döngü
python tools/stamp.py                                          # modül/varlık adreslerine içerik sürümü (import map)
python tools/server.py                                         # önbelleksiz, IPv4+IPv6 yerel sunucu
```

**Üretilen varlıklar (Higgsfield):** atlı, koçbaşı, tekne (5 yön), ahır, kuşatma atölyesi, çit, kapı, tavuk, kamp ateşi
görselleri; atlının yürüyüş/saldırı/ölüm, köylü/milis/okçu ölüm ve üç yel değirmeni videoları; gece/gündüz ambiyansı,
yağmur, rüzgâr, kamp ateşi, efektler (Mirelo) ve köy/savaş müzikleri (Sonilo).

**Animasyonlar:** Her birimin mevcut pozu düz macenta zemine konup Higgsfield'da (Kling 3.0) başlangıç ve bitiş karesi
aynı olan 3 sn'lik bir videoya çevrildi (`tools/raw/anim/*.mp4`). `process_anim.py` zemini saydamlaştırır, videodaki tek bir
döngüyü bulur (veya elle seçilmiş kareleri kullanır), boyu kaynak sprite'a eşitler ve yatay şerit olarak kaydeder.
GIF yerine kare şeridi kullanılır: canvas'a çizilen GIF tarayıcılarda oynamaz, yalnızca ilk karesi görünür.

**Performans (zoom/kaydırma):** Zeminin tamamı açılışta bir kez ~0,55 ölçekte çizilir ("genel bakış"). Uzak zoom'da
statik katman bu görüntüden kopyalanır (zorla yeniden çizimde kare süresi ~300 ms → ~16 ms). Yakın zoom'da keskin
çizim **arka tamponda, kare başına ~6 ms'lik şeritler** halinde yapılır; bu sırada eski görüntü ölçeklenerek gösterilir
ve hazır olunca yer değiştirir. Kaydırırken yeni çizim önceden başlar. Ağaç kesilmesi, bina konması gibi değişiklikler
yalnızca nesne katmanını yeniden çizer; zemin yalnızca çiftlik değişince yenilenir.
Simülasyonda yakın düşman, kule hedefi ve birimlerin itmesi mekânsal ızgarayla hesaplanır (adım başına ~0,06 ms).
Düşman renkli animasyon kareleri açılışı uzatmasın diye oyun başladıktan sonra arka planda hazırlanır.
`baslat.bat`/`baslat.sh` önce `tools/stamp.py` (sürümlü modül adresleri), sonra `tools/server.py` (Cache-Control: no-cache) çalıştırır.

## Bilinen sınırlamalar / sonraki adımlar

- **Çok oyunculu oyun yok.** Simülasyon sabit adımlı ve DOM'dan bağımsız olduğu için kilit adımlı (lockstep) ağ oyununa
  uygun; ancak bir WebSocket sunucusu, komut kuyruğu ve eşzamanlılık denetimi gerektirir.
- Düşman yapay zekâsı bina kurmaz ve yıkılan binalarını yeniden yapmaz; dalgaları zamanlayıcı + hazineyle üretir.
- Çit parçaları komşularına göre şekil değiştirmez (her karo aynı kazık öbeği).
- Koçbaşı ve teknenin ayrı hareket animasyonu yoktur (yönlü sabit görsel + yalpalama).
- Performans GPU'suz bir test tarayıcısında ölçüldü; GPU hızlandırmalı tarayıcılarda daha akıcıdır.
