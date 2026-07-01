// ============================================================
//  Standart geo ma'lumotlari (davlat -> viloyat -> tuman)
//  "Standart davlatlarni qo'shish" tugmasi shu ma'lumotni idempotent tarzda
//  bazaga singdiradi (seedDefaultGeo). O'zbekiston to'liq (14 viloyat + barcha
//  tumanlar). Qo'shni davlatlar + Rossiya — viloyat (birinchi darajali) bilan;
//  ularning tumanlarini keyinchalik shu tuzilmaga qo'shish mumkin.
// ============================================================

export interface SeedDistrict {
  name: string;
  nameUzCyrl?: string;
  nameRu?: string;
  nameEn?: string;
}
export interface SeedRegion {
  name: string;
  nameUzCyrl?: string;
  nameRu?: string;
  nameEn?: string;
  districts?: SeedDistrict[];
}
export interface SeedCountry {
  name: string;
  code?: string;
  nameUzCyrl?: string;
  nameRu?: string;
  nameEn?: string;
  regions: SeedRegion[];
}

// Tuman ro'yxatini qisqa yozish uchun yordamchi (faqat uz-lotin nom).
const d = (...names: string[]): SeedDistrict[] => names.map((name) => ({ name }));

// Viloyatsiz (birinchi darajali bo'linma) qo'shni davlatlar uchun qisqa yordamchi.
const r = (name: string, nameEn: string, nameRu?: string): SeedRegion => ({ name, nameEn, nameRu });

// ─────────────────────────── O'ZBEKISTON ───────────────────────────
const UZBEKISTAN: SeedCountry = {
  name: "O'zbekiston",
  code: 'UZ',
  nameUzCyrl: 'Ўзбекистон',
  nameRu: 'Узбекистан',
  nameEn: 'Uzbekistan',
  regions: [
    {
      name: "Qoraqalpog'iston Respublikasi",
      nameRu: 'Республика Каракалпакстан',
      nameEn: 'Karakalpakstan',
      districts: d(
        'Amudaryo', 'Beruniy', "Bo'zatov", 'Chimboy', "Ellikqal'a", 'Kegeyli', "Mo'ynoq",
        'Nukus', "Qonliko'l", "Qorao'zak", "Qo'ng'irot", 'Shumanay', "Taxtako'pir",
        "To'rtko'l", 'Xo\'jayli', 'Nukus shahri',
      ),
    },
    {
      name: 'Andijon',
      nameRu: 'Андижанская область',
      nameEn: 'Andijan',
      districts: d(
        'Andijon', 'Asaka', 'Baliqchi', "Bo'ston", 'Buloqboshi', 'Izboskan', 'Jalaquduq',
        'Xo\'jaobod', "Qo'rg'ontepa", 'Marhamat', "Oltinko'l", 'Paxtaobod', 'Shahrixon',
        "Ulug'nor", 'Andijon shahri', 'Xonobod shahri',
      ),
    },
    {
      name: 'Buxoro',
      nameRu: 'Бухарская область',
      nameEn: 'Bukhara',
      districts: d(
        'Buxoro', "G'ijduvon", 'Jondor', 'Kogon', "Qorako'l", 'Qorovulbozor', 'Olot',
        'Peshku', 'Romitan', 'Shofirkon', 'Vobkent', 'Buxoro shahri', 'Kogon shahri',
      ),
    },
    {
      name: "Farg'ona",
      nameRu: 'Ферганская область',
      nameEn: 'Fergana',
      districts: d(
        'Oltiariq', "Bag'dod", 'Beshariq', 'Buvayda', "Dang'ara", "Farg'ona", 'Furqat',
        "Qo'shtepa", 'Quva', 'Rishton', "So'x", 'Toshloq', "Uchko'prik", "O'zbekiston",
        'Yozyovon', "Farg'ona shahri", "Marg'ilon shahri", "Qo'qon shahri", 'Quvasoy shahri',
      ),
    },
    {
      name: 'Jizzax',
      nameRu: 'Джизакская область',
      nameEn: 'Jizzakh',
      districts: d(
        'Arnasoy', 'Baxmal', "Do'stlik", 'Forish', "G'allaorol", 'Sharof Rashidov',
        "Mirzacho'l", 'Paxtakor', 'Yangiobod', 'Zafarobod', 'Zarbdor', 'Zomin',
        'Jizzax', 'Jizzax shahri',
      ),
    },
    {
      name: 'Xorazm',
      nameRu: 'Хорезмская область',
      nameEn: 'Khorezm',
      districts: d(
        "Bog'ot", 'Gurlan', 'Xonqa', 'Hazorasp', 'Xiva', "Qo'shko'pir", 'Shovot',
        'Urganch', 'Yangiariq', 'Yangibozor', "Tuproqqal'a", 'Urganch shahri', 'Xiva shahri',
      ),
    },
    {
      name: 'Namangan',
      nameRu: 'Наманганская область',
      nameEn: 'Namangan',
      districts: d(
        'Chortoq', 'Chust', 'Kosonsoy', 'Mingbuloq', 'Namangan', 'Norin', 'Pop',
        "To'raqo'rg'on", "Uchqo'rg'on", 'Uychi', "Yangiqo'rg'on", 'Namangan shahri',
      ),
    },
    {
      name: 'Navoiy',
      nameRu: 'Навоийская область',
      nameEn: 'Navoiy',
      districts: d(
        'Konimex', 'Karmana', 'Navbahor', 'Nurota', 'Qiziltepa', 'Tomdi', 'Uchquduq',
        'Xatirchi', 'Navoiy shahri', 'Zarafshon shahri',
      ),
    },
    {
      name: 'Qashqadaryo',
      nameRu: 'Кашкадарьинская область',
      nameEn: 'Kashkadarya',
      districts: d(
        'Chiroqchi', 'Dehqonobod', "G'uzor", 'Kasbi', 'Kitob', 'Koson', 'Mirishkor',
        'Muborak', 'Nishon', 'Qamashi', 'Qarshi', 'Shahrisabz', "Yakkabog'", "Ko'kdala",
        'Qarshi shahri', 'Shahrisabz shahri',
      ),
    },
    {
      name: 'Samarqand',
      nameRu: 'Самаркандская область',
      nameEn: 'Samarkand',
      districts: d(
        "Bulung'ur", 'Ishtixon', 'Jomboy', "Kattaqo'rg'on", "Qo'shrabot", 'Narpay',
        'Nurobod', 'Oqdaryo', "Pastdarg'om", 'Paxtachi', 'Payariq', 'Samarqand', 'Toyloq',
        'Urgut', 'Samarqand shahri', "Kattaqo'rg'on shahri",
      ),
    },
    {
      name: 'Sirdaryo',
      nameRu: 'Сырдарьинская область',
      nameEn: 'Syrdarya',
      districts: d(
        'Oqoltin', 'Boyovut', 'Guliston', 'Xovos', 'Mirzaobod', 'Sardoba', 'Sayxunobod',
        'Sirdaryo', 'Guliston shahri', 'Shirin shahri', 'Yangiyer shahri',
      ),
    },
    {
      name: 'Surxondaryo',
      nameRu: 'Сурхандарьинская область',
      nameEn: 'Surkhandarya',
      districts: d(
        'Angor', 'Bandixon', 'Boysun', 'Denov', "Jarqo'rg'on", 'Qiziriq', "Qumqo'rg'on",
        'Muzrabot', 'Oltinsoy', 'Sariosiyo', 'Sherobod', "Sho'rchi", 'Termiz', 'Uzun',
        'Termiz shahri',
      ),
    },
    {
      name: 'Toshkent viloyati',
      nameRu: 'Ташкентская область',
      nameEn: 'Tashkent Region',
      districts: d(
        'Bekobod', "Bo'stonliq", "Bo'ka", 'Chinoz', 'Qibray', 'Ohangaron', "Oqqo'rg'on",
        'Parkent', 'Piskent', 'Quyichirchiq', "O'rtachirchiq", "Yangiyo'l", 'Yuqorichirchiq',
        'Zangiota', 'Bekobod shahri', 'Olmaliq shahri', 'Angren shahri', 'Chirchiq shahri',
        "Yangiyo'l shahri", 'Nurafshon shahri',
      ),
    },
    {
      name: 'Toshkent shahri',
      nameRu: 'город Ташкент',
      nameEn: 'Tashkent City',
      districts: d(
        'Bektemir', 'Chilonzor', 'Mirobod', "Mirzo Ulug'bek", 'Sergeli', 'Shayxontohur',
        'Olmazor', 'Uchtepa', 'Yakkasaroy', 'Yashnobod', 'Yunusobod', 'Yangihayot',
      ),
    },
  ],
};

// ─────────────────────────── QOZOG'ISTON ───────────────────────────
const KAZAKHSTAN: SeedCountry = {
  name: "Qozog'iston",
  code: 'KZ',
  nameUzCyrl: 'Қозоғистон',
  nameRu: 'Казахстан',
  nameEn: 'Kazakhstan',
  regions: [
    r('Abay', 'Abai', 'Абайская область'),
    r('Aqmola', 'Akmola', 'Акмолинская область'),
    r("Aqto'be", 'Aktobe', 'Актюбинская область'),
    r('Almati viloyati', 'Almaty Region', 'Алматинская область'),
    r('Atirau', 'Atyrau', 'Атырауская область'),
    r('Sharqiy Qozogʻiston', 'East Kazakhstan', 'Восточно-Казахстанская область'),
    r('Jambil', 'Jambyl', 'Жамбылская область'),
    r('Jetisu', 'Jetisu', 'Жетысуская область'),
    r('Gʻarbiy Qozogʻiston', 'West Kazakhstan', 'Западно-Казахстанская область'),
    r("Qarag'anda", 'Karaganda', 'Карагандинская область'),
    r('Qostanay', 'Kostanay', 'Костанайская область'),
    r("Qizilo'rda", 'Kyzylorda', 'Кызылординская область'),
    r("Mang'istau", 'Mangystau', 'Мангистауская область'),
    r('Pavlodar', 'Pavlodar', 'Павлодарская область'),
    r('Shimoliy Qozogʻiston', 'North Kazakhstan', 'Северо-Казахстанская область'),
    r('Turkiston', 'Turkistan', 'Туркестанская область'),
    r('Ulitau', 'Ulytau', 'Улытауская область'),
    r('Ostona shahri', 'Astana', 'Астана'),
    r('Almati shahri', 'Almaty', 'Алматы'),
    r('Shimkent shahri', 'Shymkent', 'Шымкент'),
  ],
};

// ─────────────────────────── QIRG'IZISTON ───────────────────────────
const KYRGYZSTAN: SeedCountry = {
  name: "Qirg'iziston",
  code: 'KG',
  nameUzCyrl: 'Қирғизистон',
  nameRu: 'Киргизия',
  nameEn: 'Kyrgyzstan',
  regions: [
    r('Batken', 'Batken', 'Баткенская область'),
    r('Chuy', 'Chuy', 'Чуйская область'),
    r('Jalolobod', 'Jalal-Abad', 'Джалал-Абадская область'),
    r('Norin', 'Naryn', 'Нарынская область'),
    r("O'sh viloyati", 'Osh Region', 'Ошская область'),
    r('Talas', 'Talas', 'Таласская область'),
    r("Issiqko'l", 'Issyk-Kul', 'Иссык-Кульская область'),
    r('Bishkek shahri', 'Bishkek', 'Бишкек'),
    r("O'sh shahri", 'Osh', 'Ош'),
  ],
};

// ─────────────────────────── TOJIKISTON ───────────────────────────
const TAJIKISTAN: SeedCountry = {
  name: 'Tojikiston',
  code: 'TJ',
  nameUzCyrl: 'Тожикистон',
  nameRu: 'Таджикистан',
  nameEn: 'Tajikistan',
  regions: [
    r("Sug'd", 'Sughd', 'Согдийская область'),
    r('Xatlon', 'Khatlon', 'Хатлонская область'),
    r('Togʻli Badaxshon', 'Gorno-Badakhshan', 'Горно-Бадахшанская АО'),
    r('Respublika tobeligidagi tumanlar', 'Districts of Republican Subordination', 'Районы республиканского подчинения'),
    r('Dushanbe shahri', 'Dushanbe', 'Душанбе'),
  ],
};

// ─────────────────────────── TURKMANISTON ───────────────────────────
const TURKMENISTAN: SeedCountry = {
  name: 'Turkmaniston',
  code: 'TM',
  nameUzCyrl: 'Туркманистон',
  nameRu: 'Туркменистан',
  nameEn: 'Turkmenistan',
  regions: [
    r('Ahal', 'Ahal', 'Ахалский велаят'),
    r('Balkan', 'Balkan', 'Балканский велаят'),
    r("Dasho'g'uz", 'Dashoguz', 'Дашогузский велаят'),
    r('Lebap', 'Lebap', 'Лебапский велаят'),
    r('Mari', 'Mary', 'Марыйский велаят'),
    r('Ashxobod shahri', 'Ashgabat', 'Ашхабад'),
  ],
};

// ─────────────────────────── AFG'ONISTON ───────────────────────────
const AFGHANISTAN: SeedCountry = {
  name: "Afg'oniston",
  code: 'AF',
  nameUzCyrl: 'Афғонистон',
  nameRu: 'Афганистан',
  nameEn: 'Afghanistan',
  regions: [
    r('Badaxshon', 'Badakhshan'), r('Badgʻis', 'Badghis'), r('Bagʻlon', 'Baghlan'),
    r('Balx', 'Balkh'), r('Bomiyon', 'Bamyan'), r('Doykundi', 'Daykundi'),
    r('Farah', 'Farah'), r('Foryob', 'Faryab'), r('Gʻazni', 'Ghazni'), r('Gʻor', 'Ghor'),
    r('Hilmand', 'Helmand'), r('Hirot', 'Herat'), r('Jovzjon', 'Jowzjan'),
    r('Kobul', 'Kabul'), r('Qandahor', 'Kandahar'), r('Kapisa', 'Kapisa'),
    r('Xost', 'Khost'), r('Kunar', 'Kunar'), r('Qunduz', 'Kunduz'), r('Lagʻmon', 'Laghman'),
    r('Logar', 'Logar'), r('Nangarhor', 'Nangarhar'), r('Nimroz', 'Nimroz'),
    r('Nuriston', 'Nuristan'), r('Paktiya', 'Paktia'), r('Paktika', 'Paktika'),
    r('Panjsher', 'Panjshir'), r('Parvon', 'Parwan'), r('Samangon', 'Samangan'),
    r('Sari Pul', 'Sar-e Pol'), r('Taxor', 'Takhar'), r('Uruzgon', 'Uruzgan'),
    r('Vardak', 'Wardak'), r('Zobul', 'Zabul'),
  ],
};

// ─────────────────────────── ROSSIYA ───────────────────────────
// Asosiy federal subyektlar (kengaytirilishi mumkin).
const RUSSIA: SeedCountry = {
  name: 'Rossiya',
  code: 'RU',
  nameUzCyrl: 'Россия',
  nameRu: 'Россия',
  nameEn: 'Russia',
  regions: [
    r('Moskva shahri', 'Moscow', 'Москва'),
    r('Sankt-Peterburg shahri', 'Saint Petersburg', 'Санкт-Петербург'),
    r('Moskva viloyati', 'Moscow Oblast', 'Московская область'),
    r('Leningrad viloyati', 'Leningrad Oblast', 'Ленинградская область'),
    r('Novosibirsk viloyati', 'Novosibirsk Oblast', 'Новосибирская область'),
    r('Sverdlovsk viloyati', 'Sverdlovsk Oblast', 'Свердловская область'),
    r('Tatariston Respublikasi', 'Republic of Tatarstan', 'Республика Татарстан'),
    r('Boshqirdiston Respublikasi', 'Republic of Bashkortostan', 'Республика Башкортостан'),
    r('Chelyabinsk viloyati', 'Chelyabinsk Oblast', 'Челябинская область'),
    r('Nijniy Novgorod viloyati', 'Nizhny Novgorod Oblast', 'Нижегородская область'),
    r('Samara viloyati', 'Samara Oblast', 'Самарская область'),
    r('Rostov viloyati', 'Rostov Oblast', 'Ростовская область'),
    r('Omsk viloyati', 'Omsk Oblast', 'Омская область'),
    r("Krasnoyarsk o'lkasi", 'Krasnoyarsk Krai', 'Красноярский край'),
    r('Voronej viloyati', 'Voronezh Oblast', 'Воронежская область'),
    r("Perm o'lkasi", 'Perm Krai', 'Пермский край'),
    r('Volgograd viloyati', 'Volgograd Oblast', 'Волгоградская область'),
    r("Krasnodar o'lkasi", 'Krasnodar Krai', 'Краснодарский край'),
    r('Saratov viloyati', 'Saratov Oblast', 'Саратовская область'),
    r('Tyumen viloyati', 'Tyumen Oblast', 'Тюменская область'),
    r('Irkutsk viloyati', 'Irkutsk Oblast', 'Иркутская область'),
    r('Kemerovo viloyati', 'Kemerovo Oblast', 'Кемеровская область'),
    r("Stavropol o'lkasi", 'Stavropol Krai', 'Ставропольский край'),
    r('Ulyanovsk viloyati', 'Ulyanovsk Oblast', 'Ульяновская область'),
    r("Primorye o'lkasi", 'Primorsky Krai', 'Приморский край'),
    r("Xabarovsk o'lkasi", 'Khabarovsk Krai', 'Хабаровский край'),
    r('Orenburg viloyati', 'Orenburg Oblast', 'Оренбургская область'),
    r('Tula viloyati', 'Tula Oblast', 'Тульская область'),
    r('Kaliningrad viloyati', 'Kaliningrad Oblast', 'Калининградская область'),
    r('Astraxan viloyati', 'Astrakhan Oblast', 'Астраханская область'),
  ],
};

export const DEFAULT_GEO: SeedCountry[] = [
  UZBEKISTAN,
  KAZAKHSTAN,
  KYRGYZSTAN,
  TAJIKISTAN,
  TURKMENISTAN,
  AFGHANISTAN,
  RUSSIA,
];
