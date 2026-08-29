# 🚀 نشر على Fly.io — خطوة بخطوة

## 📋 ما تحتاج:

1. ✅ حساب Fly.io (لديك)
2. ✅ Fly CLI — سنحمّله الآن
3. ✅ المشروع الحالي جاهز

---

## 1) تحميل Fly CLI

في PowerShell:

```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

بعد التثبيت، **أغلق وافتح PowerShell جديد** حتى يُتعرّف على `fly`.

تحقق:
```powershell
fly version
```

**لازم يطبع رقم النسخة** (مثل `Fly.io CLI v0.x.x`).

---

## 2) تسجيل الدخول

```powershell
fly auth login
```

- يفتح المتصفح
- سجّل دخولك بـ `lotfi.ma` email (أو اللي سجلت فيه)
- **ارجع لـ PowerShell** — لازم يقول "successfully logged in"

---

## 3) إنشاء التطبيق

**روح لمجلد المشروع:**
```powershell
cd $env:USERPROFILE\Desktop\Projet\football-app-v2
```

**⚠️ مهم: غيّر اسم التطبيق في `fly.toml` أولاً!**

افتح `fly.toml` بـ Notepad وغيّر السطر:
```toml
app = "football-app-lotfi"
```

إلى اسم فريد، مثل:
- `lotfi-football` (إن لم يكن محجوز)
- `kudo-football-arena`
- أي اسم غير مستخدم

**تحقق من توفر الاسم:**
```powershell
fly apps create YOUR-UNIQUE-NAME
```

لو قال "Created app" → الاسم متاح، استخدمه في fly.toml
لو قال "already taken" → جرب اسم ثاني

---

## 4) إنشاء Volume (للبيانات الدائمة)

```powershell
fly volumes create football_data --size 1 --region cdg
```

- `--size 1` = 1 GB (يكفي لسنوات!)
- `--region cdg` = Paris (الأقرب للمغرب)

---

## 5) النشر!

```powershell
fly deploy
```

**راح يستغرق 3-5 دقائق:**
- يبني Docker image
- يرفعه لـ Fly
- يشغّل التطبيق
- يعطيك رابط

**مثال على الناتج:**
```
✓ build complete
✓ deploying
✓ success
https://football-app-lotfi.fly.dev
```

**🎉 موقعك شغال على هذا الرابط من أي مكان في العالم!**

---

## 6) ربط الدومين `lotfi.ma` (اختياري)

**أ) أضف CNAME في DNS:**

في لوحة تحكم `lotfi.ma`، أضف:
- `sport.lotfi.ma` → `football-app-lotfi.fly.dev` (CNAME)

**ب) أضف الدومين لـ Fly:**
```powershell
fly certs create sport.lotfi.ma
```

**ج) فعّل HTTPS (تلقائي):**
Fly يجدد الشهادة تلقائياً.

**د) انتظر 5-10 دقائق** للنشر والتفعيل.

---

## 7) نقل بياناتك (اختياري - للبيانات المحلية)

**لو عندك DB محلية وتبي تنقلها لـ Fly:**

**أ) ارفع DB لـ volume:**
```powershell
# شغّل container مع الـ volume mounted
fly ssh console

# في الـ SSH:
ls /app/data
# Upload your local DB:
# (في terminal آخر، من جهازك)
fly ssh sftp shell
put data/football.db /app/data/football.db
```

**أو الأسهل:** سجّل دخولك على الموقع المنشور وأنشئ بيانات جديدة.

---

## 8) الأوامر المهمة لاحقاً

```powershell
# شوف اللوجات
fly logs

# ادخل الـ container
fly ssh console

# أعد النشر بعد تعديل
fly deploy

# أوقف التطبيق مؤقتاً
fly machines stop

# شوف معلومات التطبيق
fly status
fly info
```

---

## 9) الأخطاء الشائعة وحلولها

### "could not find image"
```powershell
fly deploy --no-cache
```

### "out of memory"
في `fly.toml`، غيّر:
```toml
[[vm]]
  memory = "512mb"  # بدل 256mb
```

### "volume not mounted"
```powershell
fly volumes list
fly volumes create football_data --size 1 --region cdg
fly deploy
```

### "port 3000 not accessible"
Fly يوجّه تلقائياً لـ 3000. لو ما اشتغل، شوف:
```powershell
fly logs
```

---

## 🎯 التكلفة:

- ✅ **3 VMs صغيرة مجاناً** (256MB RAM لكل واحدة)
- ✅ **1 GB volume مجاناً** (يكفي لـ 1000+ دوري)
- ✅ **160 GB نقل بيانات/شهر مجاناً**
- ✅ **HTTPS مجاني** (شهادة Let's Encrypt)
- ✅ **بدون بطاقة ائتمان مطلوبة** للخطة المجانية

---

**جاهز! ابدأ من الخطوة 1.** 🚀

أي مشكلة، أرسل لي الـ error وراح أساعدك!
