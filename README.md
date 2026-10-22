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

**Elle:** `python tools/server.py` (önbelleği kapatır: güncellemeden sonra Ctrl+F5 gerekmez) veya `npx serve -l 8080 .`

## Oynanış

- **Ana menü:** Devam Et (en son kayıt) · Yeni Oyun (zorluk Kolay/Normal/Zor, Klasik veya Rastgele harita, savaş sisi) ·
  Kayıtlı Oyunu Yükle · Ayarlar · Nasıl Oynanır. Oyun içinde **Esc/F10/P** veya üst bardaki ☰ duraklatır
  (Devam · Kaydet · Yükle · Ayarlar · Ana Menü). **F5** hızlı kayıt; ayarlarda açıksa 2 dakikada bir otomatik kayıt.
- **Ayarlar:** grafik kalitesi (Düşük/Orta/Yüksek: çözünürlük, su ve parçacık kalitesi), hava efektleri, canlılık,
  otomatik kayıt, FPS göstergesi ve dört ses seviyesi (ana, müzik, atmosfer, efektler). Değişiklikler anında uygulanır.
- **Ekonomi:** Köylüler odun, yiyecek (meyve/çiftlik), altın ve taş toplar; 10 birim dolunca en yakın uygun binaya bırakır.
- **Başlangıç:** 1000 yiyecek · 1000 odun · 500 altın · 1000 taş ve 3 köylü.
- **Binalar:** Ev · Kereste Kampı · Değirmen (kanatları döner) · Maden Kampı · Çiftlik · **Tersane** · **Ahşap Çit** ·
  **Kapı** · **Kışla** · **Okçuluk Alanı** (Feodal) · **Ahır** (Feodal) · **Gözetleme Kulesi** (Feodal) ·
  **Kuşatma Atölyesi** (Kale) · Pazar (Feodal) · Harika (İmparatorluk).
- **Tersane ve balıkçılık:** Yalnızca köylüler kurabilir ve yalnızca su kenarına yerleşir. **Balıkçı teknesi** üretir;
  tekne kendi gölündeki en yakın **balık sürüsüne** gider, ağ atar ve dolunca tersaneye boşaltır (her su kütlesi ayrı
  numaralanır, tekne başka göle gitmeye çalışmaz). Köylüler kıyıdaki balık sürüsünden de balık tutabilir.
  **Balık Ağları** (Feodal) tekneleri %50 hızlandırır. Tersanenin gölünde balık yoksa uyarı çıkar.
- **Çit ve kapı:** Çit seçiliyken başlangıç karosundan bitişe **sürükleyin**; hat 4-komşulu çizilir (delik kalmaz),
  geçersiz karolar atlanır. Köylüler parçaları sırayla kurar. **Kapı** yalnızca sizin birimlerinizi geçirir.
  Düşman askerleri yol kapalıysa çiti/kapıyı **kırarak** geçer.
- **Tamir:** Köylüleri seçip hasarlı kendi binanıza sağ tıklayın ya da binayı seçip **Tamir Ettir**'e basın (en yakın
  4 köylü gelir). Tamir, onarılan cana orantılı olarak bina maliyetinin yarısı oranında kaynak harcar.
- **Köylüleri Çağır:** Kasaba Merkezi (15) ve Gözetleme Kulesi (5) seçiliyken köylüler çanla çağrılır ve içeri sığınır:
  saldırıdan korunur, yavaşça iyileşir; her 3 köylü binaya bir ok daha attırır. **Herkes Dışarı** ile işlerine dönerler.
- **Hasar:** Tamamlanmış bina hasar aldıkça üzerinde alevler ve duman çıkar (alevler binanın kendi görselinin
  dolu piksellerine yerleşir, sayısı hasarla 1'den 7'ye çıkar). İnşaat halindeki bina tek, statik bir iskele görselidir.
- **Gece / gündüz:** Saat sunucudan (HTTP `Date` başlığı) alınır. 16:00'da hava kararmaya başlar, 17:15'ten 06:15'e
  kadar gecedir: dolunay, ışık sızan evler ve Kasaba Merkezi yanındaki kamp ateşinin başında kupalarından içen askerler.
  Üst bardaki saat düğmesi veya **L**: Otomatik → Gece → Gündüz.
- **Bekleyen inşaatlar:** Sağ üstteki listede her inşaatın yüzdesi ve işçi sayısı görünür; tıklayınca kamera binaya gider.
- **Çağlar:** Karanlık → Feodal → Kale → İmparatorluk; binaların görünümü her çağda değişir.
- **Savaş**
  - **Milis** (yakın dövüş, binalara ×3 hasar), **Okçu** (menzilli; oklar kavisli yörüngede uçar), **Atlı Keşifçi**
    (Ahır; çok hızlı, +20 can için Soy Atlar) ve **Koçbaşı** (Kuşatma Atölyesi; yalnızca binalara saldırır, binalara
    ×30 hasar, oklara neredeyse dayanıklı).
  - Hasar = max(1, saldırı − zırh); yakın dövüş ve ok zırhı ayrı. Teknolojiler: Uzun Kılıç, Pul Zırh, Talimli Okçular.
  - Askerler görüş alanındaki düşmanla kendiliğinden savaşır; saldırıya uğrayan boştaki birim karşılık verir.
  - Kasaba Merkezi ve kuleler menzile giren düşmana ok atar. Hasar alan binalar yanar; yıkılan binanın yerinde yıkıntı kalır.
- **Düşman (kırmızı):** Haritanın uzak ama karadan ulaşılabilir bir köşesinde üs kurar (Kasaba Merkezi, Kışla, Okçuluk Alanı,
  2 kule, nöbetçiler). **Ekonomisi vardır:** köylüleri üssün çevresinde kaynak toplar, düşman zamanla yeni köylü yetiştirir
  ve biriken kaynakla her dalgaya ek asker satın alır → düşman köylülerine baskın yapmak dalgaları küçültür.
  Zorluk; ilk saldırı zamanını (Kolay 8 / Normal 5 / Zor 3,5 dk), dalga aralığını, dalga büyüklüğünü, düşman köylü
  sayısını ve toplama hızını belirler. Düşman zamanla çağ atlar ve güçlenir. Kalan süre üst barda görünür.
- **Savaş sisi:** Keşfedilmemiş alanlar karanlık, görüş dışındaki alanlar yarı karanlıktır; düşman birimleri yalnızca
  görüş alanında görünür (minimap dahil). Gece görüş biraz kısalır. Yeni oyunda kapatılabilir.
- **Mevsimler ve hava:** İlkbahar → Yaz → Sonbahar → Kış (her biri 6 dakika). Sonbaharda meşeler kızıla döner, kışın
  kar örtüsü tonu ve kar yağışı olur; **kışın çiftlikler %25 yavaş, ilkbaharda %10 hızlı**. Her mevsimin kendi hava
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
| Alt menünün sağ üstündeki küçük sekme veya **F2** | Alt menüyü gizle / göster (tercih hatırlanır) |
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
python tools/server.py                                         # önbelleksiz yerel sunucu
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
`baslat.bat`/`baslat.sh` artık `tools/server.py` kullanır (Cache-Control: no-cache); güncellemeden sonra Ctrl+F5 gerekmez.

## Bilinen sınırlamalar / sonraki adımlar

- **Çok oyunculu oyun yok.** Simülasyon sabit adımlı ve DOM'dan bağımsız olduğu için kilit adımlı (lockstep) ağ oyununa
  uygun; ancak bir WebSocket sunucusu, komut kuyruğu ve eşzamanlılık denetimi gerektirir.
- Düşman yapay zekâsı bina kurmaz ve yıkılan binalarını yeniden yapmaz; dalgaları zamanlayıcı + hazineyle üretir.
- Çit parçaları komşularına göre şekil değiştirmez (her karo aynı kazık öbeği).
- Koçbaşı ve teknenin ayrı hareket animasyonu yoktur (yönlü sabit görsel + yalpalama).
- Performans GPU'suz bir test tarayıcısında ölçüldü; GPU hızlandırmalı tarayıcılarda daha akıcıdır.
