# Bilgi Düellosu — ilk online MVP

## Bu pakette
- Responsive açık temalı arayüz
- Firebase Anonymous Authentication
- Oda oluşturma (6 haneli kod) / odaya katılma
- 2 oyunculu lobby, hazır olma
- Sırayla soru cevap, süre, temel puan
- Sonuç ekranı
- Puanla rakibe görev gönderme marketi
- Görev durumunu tamamlandı olarak işaretleme
- Host tarafında cevap sonrası tur ilerletme

> Bu ilk sürüm MVP'dir. Jokerler, 300+ soru, sağlam güvenlik ve yeniden bağlanma/yeniden oynama sonraki geliştirme aşamalarında eklenmelidir. Firebase istemci tarafında cevap anahtarı ve skor doğrulaması tam güvenli değildir; gerçek anti-cheat için Cloud Functions/server-side authoritative oyun gerekir.

## 1. Firebase kurulumu
1. https://console.firebase.google.com adresinden proje oluştur.
2. Authentication > Sign-in method > Anonymous yöntemini etkinleştir.
3. Realtime Database oluştur (başlangıçta test modunu seçme; kuralları aşağıdaki dosyadan gir).
4. Project settings > General > Your apps > Web app ekle, config değerlerini kopyala.
5. `firebase-config.js` içindeki `BURAYA...` değerlerini değiştir.
6. Realtime Database > Rules bölümüne `firebase-rules.json` içeriğini yapıştır ve Publish et.

## 2. Yerelde çalıştırma
Dosyaları bir klasöre çıkar. VS Code Live Server ile `index.html` aç. Firebase yapılandırması dolu olmalı. `file://` ile açma; local server kullan.

## 3. Yayına alma
Firebase Hosting önerilir:
- Node.js ve Firebase CLI kur.
- Terminalde `npm install -g firebase-tools`
- `firebase login`
- Proje klasöründe `firebase init hosting` (public directory `.` seç, tek sayfa uygulaması hayır, var olan dosyayı overwrite etme)
- `firebase deploy`

Alternatif Netlify: klasörü deploy et; Firebase config aynı şekilde tanımlanmalı.

## Önemli
Bu MVP'nin online işlevini gerçek cihazlarda test etmek için iki farklı cihaz/browser ile oda kodu kullan. Firebase RTDB kuralları başlangıç seviyesi örnektir; üretim öncesi güvenlik kuralları ve server-side score validation güçlendirilmelidir.
