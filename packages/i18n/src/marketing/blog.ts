import { DEFAULT_LOCALE, isLocale, type Locale } from "../config";

/**
 * The blog's chrome, in every language the blog publishes in.
 *
 * WHY THIS IS ONE FILE AND NOT THIRTY-FIVE
 *
 * `./en.ts` and its thirty-four siblings are the landing page: one long
 * dictionary each, split by language, because each file is a page's worth of
 * marketing copy that a translator works through end to end. That shape is
 * right for a page and wrong for a component set. This is the sidebar, the
 * share row, the signup form and the two emails behind it — thirty-one short
 * strings that arrive together and change together, and under the other shape
 * adding one of them is thirty-five edits in thirty-five files, which is how a
 * language quietly ends up with an English string in the middle of it.
 *
 * `Record<Locale, BlogDictionary>` keeps the completeness guarantee the
 * landing page insists on: a missing language is a type error, not a gap
 * somebody finds in production. One file, one edit, still no gaps.
 *
 * The emails are in here too, and deliberately. The confirmation and the
 * welcome are the same conversation as the form — a reader who subscribes from
 * a Portuguese article and gets an English confirmation has been handed proof
 * that the Portuguese was a translation exercise rather than a publication.
 */

export type BlogDictionary = {
  /* ---- the article's furniture ---- */
  /** The heading over the sidebar's list of sections. */
  onThisPage: string;
  share: string;
  copyLink: string;
  /** Confirmation after the copy button is pressed. */
  copied: string;
  /** The heading over the related articles at the foot of a post. */
  keepReading: string;
  writtenBy: string;
  /** Heading over the tag list. */
  topics: string;
  /** Heading over the index sidebar's list of recent headlines. */
  latest: string;

  /* ---- the signup form ---- */
  subscribeTitle: string;
  subscribeBody: string;
  subscribeEmail: string;
  subscribeCta: string;
  subscribeNote: string;
  /**
   * Deliberately the same sentence whether the address was already on the
   * list, never seen, or blocked. The form is not an address checker.
   */
  subscribeDone: string;
  subscribeInvalid: string;
  /**
   * Throttled is unknown, never "check your inbox": one office or one mobile
   * network is many people behind one address, and a first-time subscriber can
   * trip the limit having done nothing.
   */
  subscribeTooMany: string;

  /* ---- the page the confirmation link opens ---- */
  confirmTitle: string;
  confirmBody: string;
  confirmCta: string;
  confirmedTitle: string;
  confirmedBody: string;
  expiredTitle: string;
  expiredBody: string;

  /* ---- the confirmation email ---- */
  mailSubject: string;
  /** Follows the reader's name when there is one, so it starts lower-case. */
  mailBody: string;
  mailCta: string;
  mailIgnore: string;

  /* ---- the welcome, sent the moment they confirm ---- */
  welcomeSubject: string;
  /** Follows the reader's name when there is one, so it starts lower-case. */
  welcomeBody: string;
  welcomeCta: string;
  unsubscribe: string;
};

const en: BlogDictionary = {
  onThisPage: "On this page",
  share: "Share",
  copyLink: "Copy link",
  copied: "Link copied",
  keepReading: "Keep reading",
  writtenBy: "Written by",
  topics: "Topics",
  latest: "Latest",
  subscribeTitle: "Notes on selling, twice a month",
  subscribeBody:
    "One email on pricing, photographs, delivery and getting paid. No pitch, no filler.",
  subscribeEmail: "Your email address",
  subscribeCta: "Subscribe",
  subscribeNote: "Unsubscribe any time. Your address is never sold or shared.",
  subscribeDone: "Almost there — open the email we just sent and tap confirm.",
  subscribeInvalid: "That address doesn't look right.",
  subscribeTooMany:
    "Too many sign-ups from here just now — try again in a few minutes.",
  confirmTitle: "Confirm your subscription",
  confirmBody:
    "Tap below and we'll send you the newsletter. Nothing else, and nothing at all until you do.",
  confirmCta: "Yes, subscribe me",
  confirmedTitle: "You're on the list",
  confirmedBody: "We'll be in touch when there's something worth reading.",
  expiredTitle: "This link has expired",
  expiredBody:
    "Confirmation links last a few days. Sign up again and we'll send a fresh one.",
  mailSubject: "Confirm your Sailo subscription",
  mailBody:
    "someone asked to receive the Sailo newsletter at this address. Tap below and you're on the list.",
  mailCta: "Confirm my subscription",
  mailIgnore:
    "If it wasn't you, ignore this email — nothing has been added anywhere.",
  welcomeSubject: "You're on the list",
  welcomeBody:
    "thanks for subscribing. Twice a month we send one email about selling online — pricing, photographs, delivery, and what actually works. Everything we have written so far is waiting for you.",
  welcomeCta: "Read the blog",
  unsubscribe: "Unsubscribe",
};

const ar: BlogDictionary = {
  onThisPage: "في هذه الصفحة",
  share: "مشاركة",
  copyLink: "نسخ الرابط",
  copied: "تم نسخ الرابط",
  keepReading: "تابع القراءة",
  writtenBy: "بقلم",
  topics: "المواضيع",
  latest: "الأحدث",
  subscribeTitle: "ملاحظات عن البيع، مرّتين شهريًا",
  subscribeBody:
    "رسالة واحدة عن التسعير والصور والتوصيل واستلام المال. بلا دعاية وبلا حشو.",
  subscribeEmail: "بريدك الإلكتروني",
  subscribeCta: "اشترك",
  subscribeNote: "يمكنك إلغاء الاشتراك متى شئت. لا نبيع عنوانك ولا نشاركه أبدًا.",
  subscribeDone: "بقيت خطوة — افتح الرسالة التي أرسلناها للتوّ واضغط على التأكيد.",
  subscribeInvalid: "هذا العنوان لا يبدو صحيحًا.",
  subscribeTooMany:
    "محاولات تسجيل كثيرة من هنا الآن — أعد المحاولة بعد بضع دقائق.",
  confirmTitle: "أكّد اشتراكك",
  confirmBody:
    "اضغط أدناه وسنرسل لك النشرة. لا شيء غير ذلك، ولا شيء إطلاقًا قبل أن تفعل.",
  confirmCta: "نعم، اشتركني",
  confirmedTitle: "أصبحت ضمن القائمة",
  confirmedBody: "سنكتب إليك عندما يكون هناك ما يستحق القراءة.",
  expiredTitle: "انتهت صلاحية هذا الرابط",
  expiredBody:
    "روابط التأكيد تدوم بضعة أيام. سجّل مرة أخرى وسنرسل لك رابطًا جديدًا.",
  mailSubject: "أكّد اشتراكك في نشرة Sailo",
  mailBody:
    "طلب أحدهم استلام نشرة Sailo على هذا العنوان. اضغط أدناه وتصبح ضمن القائمة.",
  mailCta: "تأكيد اشتراكي",
  mailIgnore: "إن لم تكن أنت، تجاهل هذه الرسالة — لم يُضف شيء في أي مكان.",
  welcomeSubject: "أصبحت ضمن القائمة",
  welcomeBody:
    "شكرًا لاشتراكك. مرّتين في الشهر نرسل رسالة واحدة عن البيع عبر الإنترنت — التسعير والصور والتوصيل وما ينجح فعلًا. كل ما كتبناه حتى الآن بانتظارك.",
  welcomeCta: "اقرأ المدوّنة",
  unsubscribe: "إلغاء الاشتراك",
};

const bg: BlogDictionary = {
  onThisPage: "В тази страница",
  share: "Споделяне",
  copyLink: "Копирай връзката",
  copied: "Връзката е копирана",
  keepReading: "Продължете да четете",
  writtenBy: "Автор",
  topics: "Теми",
  latest: "Най-нови",
  subscribeTitle: "Бележки за продаването, два пъти месечно",
  subscribeBody:
    "Едно писмо за цени, снимки, доставка и получаване на пари. Без реклама и без пълнеж.",
  subscribeEmail: "Вашият имейл адрес",
  subscribeCta: "Абонирай ме",
  subscribeNote:
    "Отписване по всяко време. Адресът ви никога не се продава и не се споделя.",
  subscribeDone:
    "Почти готово — отворете писмото, което току-що изпратихме, и потвърдете.",
  subscribeInvalid: "Този адрес не изглежда правилен.",
  subscribeTooMany:
    "Твърде много записвания оттук в момента — опитайте пак след няколко минути.",
  confirmTitle: "Потвърдете абонамента си",
  confirmBody:
    "Натиснете отдолу и ще ви изпращаме бюлетина. Нищо друго и абсолютно нищо, докато не го направите.",
  confirmCta: "Да, абонирай ме",
  confirmedTitle: "Вече сте в списъка",
  confirmedBody: "Ще се свържем с вас, когато има нещо, което си струва да прочетете.",
  expiredTitle: "Тази връзка е изтекла",
  expiredBody:
    "Връзките за потвърждение важат няколко дни. Запишете се отново и ще изпратим нова.",
  mailSubject: "Потвърдете абонамента си за Sailo",
  mailBody:
    "някой поиска бюлетинът на Sailo да пристига на този адрес. Натиснете отдолу и сте в списъка.",
  mailCta: "Потвърждавам абонамента",
  mailIgnore:
    "Ако не сте били вие, просто пренебрегнете това писмо — никъде нищо не е добавено.",
  welcomeSubject: "Вече сте в списъка",
  welcomeBody:
    "благодарим, че се абонирахте. Два пъти месечно изпращаме едно писмо за продаването онлайн — цени, снимки, доставка и какво наистина работи. Всичко, което сме написали досега, ви очаква.",
  welcomeCta: "Към блога",
  unsubscribe: "Отписване",
};

const bs: BlogDictionary = {
  onThisPage: "Na ovoj stranici",
  share: "Podijeli",
  copyLink: "Kopiraj link",
  copied: "Link kopiran",
  keepReading: "Nastavite čitati",
  writtenBy: "Napisao",
  topics: "Teme",
  latest: "Najnovije",
  subscribeTitle: "Bilješke o prodaji, dva puta mjesečno",
  subscribeBody:
    "Jedan email o cijenama, fotografijama, dostavi i naplati. Bez reklame i bez punjenja.",
  subscribeEmail: "Vaša email adresa",
  subscribeCta: "Prijavi me",
  subscribeNote:
    "Odjava u svakom trenutku. Vaša adresa se nikada ne prodaje niti dijeli.",
  subscribeDone: "Skoro gotovo — otvorite email koji smo upravo poslali i potvrdite.",
  subscribeInvalid: "Ta adresa ne izgleda ispravno.",
  subscribeTooMany:
    "Previše prijava odavde u ovom trenutku — pokušajte za nekoliko minuta.",
  confirmTitle: "Potvrdite pretplatu",
  confirmBody:
    "Kliknite ispod i slat ćemo vam newsletter. Ništa drugo, i baš ništa dok to ne uradite.",
  confirmCta: "Da, prijavi me",
  confirmedTitle: "Na listi ste",
  confirmedBody: "Javit ćemo se kada bude nešto što vrijedi pročitati.",
  expiredTitle: "Ovaj link je istekao",
  expiredBody:
    "Linkovi za potvrdu traju nekoliko dana. Prijavite se ponovo i poslat ćemo novi.",
  mailSubject: "Potvrdite pretplatu na Sailo",
  mailBody:
    "neko je zatražio Sailo newsletter na ovu adresu. Kliknite ispod i na listi ste.",
  mailCta: "Potvrđujem pretplatu",
  mailIgnore:
    "Ako to niste bili vi, zanemarite ovaj email — nigdje ništa nije dodano.",
  welcomeSubject: "Na listi ste",
  welcomeBody:
    "hvala na pretplati. Dva puta mjesečno šaljemo jedan email o online prodaji — cijene, fotografije, dostava i ono što zaista radi. Sve što smo dosad napisali čeka vas.",
  welcomeCta: "Pročitajte blog",
  unsubscribe: "Odjava",
};

const cs: BlogDictionary = {
  onThisPage: "Na této stránce",
  share: "Sdílet",
  copyLink: "Kopírovat odkaz",
  copied: "Odkaz zkopírován",
  keepReading: "Čtěte dál",
  writtenBy: "Napsal",
  topics: "Témata",
  latest: "Nejnovější",
  subscribeTitle: "Poznámky o prodeji, dvakrát měsíčně",
  subscribeBody:
    "Jeden e-mail o cenách, fotkách, doručení a placení. Žádná reklama, žádná vata.",
  subscribeEmail: "Vaše e-mailová adresa",
  subscribeCta: "Odebírat",
  subscribeNote:
    "Odhlásit se můžete kdykoli. Vaši adresu nikdy neprodáváme ani nesdílíme.",
  subscribeDone:
    "Skoro hotovo — otevřete e-mail, který jsme právě poslali, a potvrďte.",
  subscribeInvalid: "Tato adresa nevypadá správně.",
  subscribeTooMany:
    "Momentálně je odsud příliš mnoho registrací — zkuste to za pár minut.",
  confirmTitle: "Potvrďte odběr",
  confirmBody:
    "Klepněte níže a budeme vám posílat newsletter. Nic jiného a vůbec nic, dokud to neuděláte.",
  confirmCta: "Ano, chci odebírat",
  confirmedTitle: "Jste na seznamu",
  confirmedBody: "Ozveme se, až bude něco, co stojí za přečtení.",
  expiredTitle: "Platnost odkazu vypršela",
  expiredBody:
    "Potvrzovací odkazy platí několik dní. Přihlaste se znovu a pošleme vám nový.",
  mailSubject: "Potvrďte odběr novinek Sailo",
  mailBody:
    "někdo požádal o zasílání newsletteru Sailo na tuto adresu. Klepněte níže a jste na seznamu.",
  mailCta: "Potvrdit odběr",
  mailIgnore:
    "Pokud jste to nebyli vy, tento e-mail ignorujte — nikam se nic nepřidalo.",
  welcomeSubject: "Jste na seznamu",
  welcomeBody:
    "díky za odběr. Dvakrát měsíčně posíláme jeden e-mail o prodeji online — ceny, fotky, doručení a co skutečně funguje. Všechno, co jsme dosud napsali, na vás čeká.",
  welcomeCta: "Přečíst blog",
  unsubscribe: "Odhlásit odběr",
};

const da: BlogDictionary = {
  onThisPage: "På denne side",
  share: "Del",
  copyLink: "Kopiér link",
  copied: "Link kopieret",
  keepReading: "Læs videre",
  writtenBy: "Skrevet af",
  topics: "Emner",
  latest: "Nyeste",
  subscribeTitle: "Noter om at sælge, to gange om måneden",
  subscribeBody:
    "Én mail om priser, billeder, levering og at få pengene. Ingen reklame, ingen fyld.",
  subscribeEmail: "Din e-mailadresse",
  subscribeCta: "Tilmeld",
  subscribeNote:
    "Afmeld når som helst. Din adresse bliver aldrig solgt eller delt.",
  subscribeDone: "Næsten der — åbn mailen, vi lige har sendt, og tryk bekræft.",
  subscribeInvalid: "Den adresse ser ikke rigtig ud.",
  subscribeTooMany:
    "For mange tilmeldinger herfra lige nu — prøv igen om et par minutter.",
  confirmTitle: "Bekræft din tilmelding",
  confirmBody:
    "Tryk nedenfor, så sender vi nyhedsbrevet. Intet andet — og slet intet, før du gør det.",
  confirmCta: "Ja, tilmeld mig",
  confirmedTitle: "Du er på listen",
  confirmedBody: "Vi skriver, når der er noget, der er værd at læse.",
  expiredTitle: "Dette link er udløbet",
  expiredBody:
    "Bekræftelseslinks holder et par dage. Tilmeld dig igen, så sender vi et nyt.",
  mailSubject: "Bekræft din tilmelding til Sailo",
  mailBody:
    "nogen har bedt om at få Sailos nyhedsbrev på denne adresse. Tryk nedenfor, så er du på listen.",
  mailCta: "Bekræft min tilmelding",
  mailIgnore:
    "Var det ikke dig, så ignorér denne mail — der er ikke tilføjet noget nogen steder.",
  welcomeSubject: "Du er på listen",
  welcomeBody:
    "tak fordi du tilmeldte dig. To gange om måneden sender vi én mail om at sælge online — priser, billeder, levering og hvad der faktisk virker. Alt, hvad vi har skrevet indtil nu, venter på dig.",
  welcomeCta: "Læs bloggen",
  unsubscribe: "Afmeld",
};

const de: BlogDictionary = {
  onThisPage: "Auf dieser Seite",
  share: "Teilen",
  copyLink: "Link kopieren",
  copied: "Link kopiert",
  keepReading: "Weiterlesen",
  writtenBy: "Geschrieben von",
  topics: "Themen",
  latest: "Neueste",
  subscribeTitle: "Notizen zum Verkaufen, zweimal im Monat",
  subscribeBody:
    "Eine E-Mail über Preise, Fotos, Versand und Bezahltwerden. Keine Werbung, keine Füllsätze.",
  subscribeEmail: "Deine E-Mail-Adresse",
  subscribeCta: "Abonnieren",
  subscribeNote:
    "Jederzeit abbestellbar. Deine Adresse wird nie verkauft oder weitergegeben.",
  subscribeDone:
    "Fast geschafft — öffne die E-Mail, die wir gerade geschickt haben, und bestätige.",
  subscribeInvalid: "Diese Adresse sieht nicht richtig aus.",
  subscribeTooMany:
    "Gerade zu viele Anmeldungen von hier — versuch es in ein paar Minuten noch einmal.",
  confirmTitle: "Abo bestätigen",
  confirmBody:
    "Tipp unten, dann schicken wir dir den Newsletter. Sonst nichts — und gar nichts, bevor du es tust.",
  confirmCta: "Ja, bitte anmelden",
  confirmedTitle: "Du bist dabei",
  confirmedBody: "Wir melden uns, wenn es etwas zu lesen gibt, das sich lohnt.",
  expiredTitle: "Dieser Link ist abgelaufen",
  expiredBody:
    "Bestätigungslinks gelten ein paar Tage. Melde dich erneut an, dann schicken wir einen neuen.",
  mailSubject: "Bestätige dein Sailo-Abo",
  mailBody:
    "jemand möchte den Sailo-Newsletter an diese Adresse bekommen. Tipp unten, dann bist du dabei.",
  mailCta: "Abo bestätigen",
  mailIgnore:
    "Warst du das nicht, ignoriere diese E-Mail einfach — es wurde nirgends etwas eingetragen.",
  welcomeSubject: "Du bist dabei",
  welcomeBody:
    "danke fürs Abonnieren. Zweimal im Monat kommt eine E-Mail übers Online-Verkaufen — Preise, Fotos, Versand und was wirklich funktioniert. Alles, was wir bisher geschrieben haben, wartet auf dich.",
  welcomeCta: "Zum Blog",
  unsubscribe: "Abbestellen",
};

const el: BlogDictionary = {
  onThisPage: "Σε αυτή τη σελίδα",
  share: "Κοινοποίηση",
  copyLink: "Αντιγραφή συνδέσμου",
  copied: "Ο σύνδεσμος αντιγράφηκε",
  keepReading: "Συνεχίστε την ανάγνωση",
  writtenBy: "Γράφτηκε από",
  topics: "Θέματα",
  latest: "Πρόσφατα",
  subscribeTitle: "Σημειώσεις για τις πωλήσεις, δύο φορές τον μήνα",
  subscribeBody:
    "Ένα email για τιμές, φωτογραφίες, παράδοση και πληρωμές. Χωρίς διαφήμιση, χωρίς γέμισμα.",
  subscribeEmail: "Η διεύθυνση email σας",
  subscribeCta: "Εγγραφή",
  subscribeNote:
    "Διαγραφή όποτε θέλετε. Η διεύθυνσή σας δεν πωλείται και δεν κοινοποιείται ποτέ.",
  subscribeDone:
    "Σχεδόν έτοιμο — ανοίξτε το email που μόλις στείλαμε και πατήστε επιβεβαίωση.",
  subscribeInvalid: "Αυτή η διεύθυνση δεν φαίνεται σωστή.",
  subscribeTooMany:
    "Πάρα πολλές εγγραφές από εδώ αυτή τη στιγμή — δοκιμάστε ξανά σε λίγα λεπτά.",
  confirmTitle: "Επιβεβαιώστε την εγγραφή σας",
  confirmBody:
    "Πατήστε παρακάτω και θα σας στέλνουμε το newsletter. Τίποτα άλλο, και τίποτα απολύτως μέχρι να το κάνετε.",
  confirmCta: "Ναι, εγγράψτε με",
  confirmedTitle: "Είστε στη λίστα",
  confirmedBody: "Θα επικοινωνήσουμε όταν υπάρχει κάτι που αξίζει να διαβάσετε.",
  expiredTitle: "Ο σύνδεσμος έληξε",
  expiredBody:
    "Οι σύνδεσμοι επιβεβαίωσης ισχύουν για λίγες ημέρες. Εγγραφείτε ξανά και θα στείλουμε νέο.",
  mailSubject: "Επιβεβαιώστε την εγγραφή σας στο Sailo",
  mailBody:
    "κάποιος ζήτησε να λαμβάνει το newsletter του Sailo σε αυτή τη διεύθυνση. Πατήστε παρακάτω και είστε στη λίστα.",
  mailCta: "Επιβεβαίωση εγγραφής",
  mailIgnore:
    "Αν δεν ήσασταν εσείς, αγνοήστε αυτό το email — δεν προστέθηκε τίποτα πουθενά.",
  welcomeSubject: "Είστε στη λίστα",
  welcomeBody:
    "ευχαριστούμε για την εγγραφή. Δύο φορές τον μήνα στέλνουμε ένα email για τις online πωλήσεις — τιμές, φωτογραφίες, παράδοση και τι πραγματικά δουλεύει. Όλα όσα έχουμε γράψει μέχρι τώρα σας περιμένουν.",
  welcomeCta: "Διαβάστε το blog",
  unsubscribe: "Διαγραφή",
};

const es: BlogDictionary = {
  onThisPage: "En esta página",
  share: "Compartir",
  copyLink: "Copiar enlace",
  copied: "Enlace copiado",
  keepReading: "Sigue leyendo",
  writtenBy: "Escrito por",
  topics: "Temas",
  latest: "Lo último",
  subscribeTitle: "Notas sobre vender, dos veces al mes",
  subscribeBody:
    "Un correo sobre precios, fotos, envíos y cobrar. Sin publicidad y sin relleno.",
  subscribeEmail: "Tu correo electrónico",
  subscribeCta: "Suscribirme",
  subscribeNote:
    "Puedes darte de baja cuando quieras. Tu dirección nunca se vende ni se comparte.",
  subscribeDone:
    "Casi está — abre el correo que acabamos de enviarte y pulsa confirmar.",
  subscribeInvalid: "Esa dirección no parece correcta.",
  subscribeTooMany:
    "Demasiadas altas desde aquí ahora mismo — inténtalo dentro de unos minutos.",
  confirmTitle: "Confirma tu suscripción",
  confirmBody:
    "Pulsa abajo y te enviaremos el boletín. Nada más, y nada en absoluto hasta que lo hagas.",
  confirmCta: "Sí, suscríbeme",
  confirmedTitle: "Ya estás en la lista",
  confirmedBody: "Te escribiremos cuando haya algo que merezca la pena leer.",
  expiredTitle: "Este enlace ha caducado",
  expiredBody:
    "Los enlaces de confirmación duran unos días. Vuelve a suscribirte y te enviamos uno nuevo.",
  mailSubject: "Confirma tu suscripción a Sailo",
  mailBody:
    "alguien ha pedido recibir el boletín de Sailo en esta dirección. Pulsa abajo y estarás en la lista.",
  mailCta: "Confirmar mi suscripción",
  mailIgnore:
    "Si no has sido tú, ignora este correo — no se ha añadido nada en ningún sitio.",
  welcomeSubject: "Ya estás en la lista",
  welcomeBody:
    "gracias por suscribirte. Dos veces al mes enviamos un correo sobre vender por internet — precios, fotos, envíos y lo que de verdad funciona. Todo lo que hemos escrito hasta ahora te está esperando.",
  welcomeCta: "Leer el blog",
  unsubscribe: "Darse de baja",
};

const fi: BlogDictionary = {
  onThisPage: "Tällä sivulla",
  share: "Jaa",
  copyLink: "Kopioi linkki",
  copied: "Linkki kopioitu",
  keepReading: "Lue lisää",
  writtenBy: "Kirjoittanut",
  topics: "Aiheet",
  latest: "Uusimmat",
  subscribeTitle: "Muistiinpanoja myymisestä, kahdesti kuussa",
  subscribeBody:
    "Yksi sähköposti hinnoittelusta, kuvista, toimituksesta ja rahan saamisesta. Ei mainoksia eikä täytettä.",
  subscribeEmail: "Sähköpostiosoitteesi",
  subscribeCta: "Tilaa",
  subscribeNote:
    "Voit peruuttaa milloin tahansa. Osoitettasi ei koskaan myydä eikä jaeta.",
  subscribeDone:
    "Melkein valmista — avaa juuri lähettämämme sähköposti ja vahvista.",
  subscribeInvalid: "Tuo osoite ei näytä oikealta.",
  subscribeTooMany:
    "Liian monta tilausta täältä juuri nyt — yritä uudelleen muutaman minuutin kuluttua.",
  confirmTitle: "Vahvista tilauksesi",
  confirmBody:
    "Napauta alta, niin lähetämme uutiskirjeen. Ei mitään muuta — eikä yhtään mitään ennen sitä.",
  confirmCta: "Kyllä, tilaan",
  confirmedTitle: "Olet listalla",
  confirmedBody: "Otamme yhteyttä, kun on jotain lukemisen arvoista.",
  expiredTitle: "Tämä linkki on vanhentunut",
  expiredBody:
    "Vahvistuslinkit ovat voimassa muutaman päivän. Tilaa uudelleen, niin lähetämme uuden.",
  mailSubject: "Vahvista Sailo-tilauksesi",
  mailBody:
    "joku pyysi Sailon uutiskirjettä tähän osoitteeseen. Napauta alta, niin olet listalla.",
  mailCta: "Vahvista tilaukseni",
  mailIgnore:
    "Jos se et ollut sinä, jätä tämä viesti huomiotta — mitään ei ole lisätty mihinkään.",
  welcomeSubject: "Olet listalla",
  welcomeBody:
    "kiitos tilauksesta. Kahdesti kuussa lähetämme yhden sähköpostin verkkomyynnistä — hinnoittelusta, kuvista, toimituksesta ja siitä mikä oikeasti toimii. Kaikki tähän mennessä kirjoittamamme odottaa sinua.",
  welcomeCta: "Lue blogi",
  unsubscribe: "Peruuta tilaus",
};

const fil: BlogDictionary = {
  onThisPage: "Nasa pahinang ito",
  share: "Ibahagi",
  copyLink: "Kopyahin ang link",
  copied: "Nakopya ang link",
  keepReading: "Magpatuloy sa pagbabasa",
  writtenBy: "Isinulat ni",
  topics: "Mga paksa",
  latest: "Pinakabago",
  subscribeTitle: "Mga tala tungkol sa pagbebenta, dalawang beses bawat buwan",
  subscribeBody:
    "Isang email tungkol sa presyo, litrato, delivery at pagpapabayad. Walang bola, walang palaman.",
  subscribeEmail: "Ang iyong email address",
  subscribeCta: "Mag-subscribe",
  subscribeNote:
    "Puwedeng mag-unsubscribe anumang oras. Hindi kailanman ibinebenta o ibinabahagi ang address mo.",
  subscribeDone:
    "Malapit na — buksan ang email na kadadala lang namin at pindutin ang kumpirmahin.",
  subscribeInvalid: "Mukhang mali ang address na iyon.",
  subscribeTooMany:
    "Napakaraming sign-up mula rito ngayon — subukan ulit pagkalipas ng ilang minuto.",
  confirmTitle: "Kumpirmahin ang iyong subscription",
  confirmBody:
    "Pindutin sa ibaba at ipapadala namin ang newsletter. Wala nang iba, at wala talaga hangga't hindi mo ito ginagawa.",
  confirmCta: "Oo, i-subscribe ako",
  confirmedTitle: "Nasa listahan ka na",
  confirmedBody: "Susulatan ka namin kapag may bagay na sulit basahin.",
  expiredTitle: "Nag-expire na ang link na ito",
  expiredBody:
    "Ilang araw lang tumatagal ang mga confirmation link. Mag-sign up ulit at magpapadala kami ng bago.",
  mailSubject: "Kumpirmahin ang iyong Sailo subscription",
  mailBody:
    "may humiling na matanggap ang Sailo newsletter sa address na ito. Pindutin sa ibaba at nasa listahan ka na.",
  mailCta: "Kumpirmahin ang subscription",
  mailIgnore:
    "Kung hindi ikaw iyon, huwag pansinin ang email na ito — walang naidagdag kahit saan.",
  welcomeSubject: "Nasa listahan ka na",
  welcomeBody:
    "salamat sa pag-subscribe. Dalawang beses bawat buwan, isang email tungkol sa pagbebenta online — presyo, litrato, delivery, at kung ano talaga ang umuubra. Naghihintay sa iyo ang lahat ng naisulat namin.",
  welcomeCta: "Basahin ang blog",
  unsubscribe: "Mag-unsubscribe",
};

const fr: BlogDictionary = {
  onThisPage: "Sur cette page",
  share: "Partager",
  copyLink: "Copier le lien",
  copied: "Lien copié",
  keepReading: "À lire ensuite",
  writtenBy: "Écrit par",
  topics: "Thèmes",
  latest: "Derniers articles",
  subscribeTitle: "Notes sur la vente, deux fois par mois",
  subscribeBody:
    "Un e-mail sur les prix, les photos, la livraison et le fait d'être payé. Sans pub et sans remplissage.",
  subscribeEmail: "Votre adresse e-mail",
  subscribeCta: "S'abonner",
  subscribeNote:
    "Désabonnement à tout moment. Votre adresse n'est jamais vendue ni partagée.",
  subscribeDone:
    "Presque — ouvrez l'e-mail que nous venons d'envoyer et appuyez sur confirmer.",
  subscribeInvalid: "Cette adresse ne semble pas correcte.",
  subscribeTooMany:
    "Trop d'inscriptions depuis ici en ce moment — réessayez dans quelques minutes.",
  confirmTitle: "Confirmez votre abonnement",
  confirmBody:
    "Appuyez ci-dessous et nous vous enverrons la newsletter. Rien d'autre, et rien du tout tant que vous ne l'aurez pas fait.",
  confirmCta: "Oui, abonnez-moi",
  confirmedTitle: "Vous êtes inscrit",
  confirmedBody: "Nous vous écrirons quand il y aura quelque chose à lire.",
  expiredTitle: "Ce lien a expiré",
  expiredBody:
    "Les liens de confirmation durent quelques jours. Inscrivez-vous à nouveau et nous en enverrons un neuf.",
  mailSubject: "Confirmez votre abonnement à Sailo",
  mailBody:
    "quelqu'un a demandé à recevoir la newsletter Sailo à cette adresse. Appuyez ci-dessous et vous êtes inscrit.",
  mailCta: "Confirmer mon abonnement",
  mailIgnore:
    "Si ce n'était pas vous, ignorez cet e-mail — rien n'a été ajouté nulle part.",
  welcomeSubject: "Vous êtes inscrit",
  welcomeBody:
    "merci pour votre abonnement. Deux fois par mois, un e-mail sur la vente en ligne — prix, photos, livraison, et ce qui marche vraiment. Tout ce que nous avons écrit jusqu'ici vous attend.",
  welcomeCta: "Lire le blog",
  unsubscribe: "Se désabonner",
};

const hr: BlogDictionary = {
  onThisPage: "Na ovoj stranici",
  share: "Podijeli",
  copyLink: "Kopiraj poveznicu",
  copied: "Poveznica kopirana",
  keepReading: "Nastavite čitati",
  writtenBy: "Napisao",
  topics: "Teme",
  latest: "Najnovije",
  subscribeTitle: "Bilješke o prodaji, dvaput mjesečno",
  subscribeBody:
    "Jedan e-mail o cijenama, fotografijama, dostavi i naplati. Bez reklame i bez punjenja.",
  subscribeEmail: "Vaša e-mail adresa",
  subscribeCta: "Pretplati me",
  subscribeNote:
    "Odjava u bilo kojem trenutku. Vaša se adresa nikada ne prodaje ni ne dijeli.",
  subscribeDone: "Skoro gotovo — otvorite e-mail koji smo upravo poslali i potvrdite.",
  subscribeInvalid: "Ta adresa ne izgleda ispravno.",
  subscribeTooMany:
    "Previše prijava odavde upravo sada — pokušajte za nekoliko minuta.",
  confirmTitle: "Potvrdite pretplatu",
  confirmBody:
    "Kliknite ispod i slat ćemo vam newsletter. Ništa drugo, i baš ništa dok to ne učinite.",
  confirmCta: "Da, pretplati me",
  confirmedTitle: "Na popisu ste",
  confirmedBody: "Javit ćemo se kad bude nešto vrijedno čitanja.",
  expiredTitle: "Ova je poveznica istekla",
  expiredBody:
    "Poveznice za potvrdu traju nekoliko dana. Prijavite se ponovno i poslat ćemo novu.",
  mailSubject: "Potvrdite pretplatu na Sailo",
  mailBody:
    "netko je zatražio Sailo newsletter na ovu adresu. Kliknite ispod i na popisu ste.",
  mailCta: "Potvrđujem pretplatu",
  mailIgnore:
    "Ako to niste bili vi, zanemarite ovaj e-mail — nigdje ništa nije dodano.",
  welcomeSubject: "Na popisu ste",
  welcomeBody:
    "hvala na pretplati. Dvaput mjesečno šaljemo jedan e-mail o online prodaji — cijene, fotografije, dostava i ono što stvarno funkcionira. Sve što smo dosad napisali čeka vas.",
  welcomeCta: "Pročitajte blog",
  unsubscribe: "Odjava",
};

const hu: BlogDictionary = {
  onThisPage: "Ezen az oldalon",
  share: "Megosztás",
  copyLink: "Link másolása",
  copied: "Link kimásolva",
  keepReading: "Olvasson tovább",
  writtenBy: "Írta",
  topics: "Témák",
  latest: "Legfrissebb",
  subscribeTitle: "Jegyzetek az eladásról, havonta kétszer",
  subscribeBody:
    "Egy e-mail az árazásról, a fotókról, a szállításról és a fizetségről. Reklám és töltelék nélkül.",
  subscribeEmail: "Az e-mail-címed",
  subscribeCta: "Feliratkozom",
  subscribeNote:
    "Bármikor leiratkozhatsz. A címedet soha nem adjuk el és nem osztjuk meg.",
  subscribeDone:
    "Majdnem kész — nyisd meg az imént küldött e-mailt, és erősítsd meg.",
  subscribeInvalid: "Ez a cím nem tűnik helyesnek.",
  subscribeTooMany:
    "Túl sok feliratkozás érkezett innen az imént — próbáld újra pár perc múlva.",
  confirmTitle: "Erősítsd meg a feliratkozást",
  confirmBody:
    "Koppints alább, és küldjük a hírlevelet. Semmi mást, és egyáltalán semmit, amíg meg nem teszed.",
  confirmCta: "Igen, feliratkozom",
  confirmedTitle: "Rajta vagy a listán",
  confirmedBody: "Jelentkezünk, amint lesz valami, amit érdemes elolvasni.",
  expiredTitle: "Ez a link lejárt",
  expiredBody:
    "A megerősítő linkek néhány napig élnek. Iratkozz fel újra, és küldünk egy frisset.",
  mailSubject: "Erősítsd meg a Sailo-feliratkozásod",
  mailBody:
    "valaki kérte, hogy a Sailo hírlevele erre a címre érkezzen. Koppints alább, és rajta vagy a listán.",
  mailCta: "Feliratkozás megerősítése",
  mailIgnore:
    "Ha nem te voltál, hagyd figyelmen kívül ezt a levelet — sehová nem került be semmi.",
  welcomeSubject: "Rajta vagy a listán",
  welcomeBody:
    "köszönjük a feliratkozást. Havonta kétszer küldünk egy e-mailt az online eladásról — árazás, fotók, szállítás, és ami tényleg működik. Minden, amit eddig írtunk, ott vár rád.",
  welcomeCta: "Olvasd a blogot",
  unsubscribe: "Leiratkozás",
};

const id: BlogDictionary = {
  onThisPage: "Di halaman ini",
  share: "Bagikan",
  copyLink: "Salin tautan",
  copied: "Tautan disalin",
  keepReading: "Lanjut membaca",
  writtenBy: "Ditulis oleh",
  topics: "Topik",
  latest: "Terbaru",
  subscribeTitle: "Catatan tentang berjualan, dua kali sebulan",
  subscribeBody:
    "Satu email tentang harga, foto, pengiriman, dan cara dibayar. Tanpa iklan, tanpa basa-basi.",
  subscribeEmail: "Alamat email Anda",
  subscribeCta: "Berlangganan",
  subscribeNote:
    "Berhenti kapan saja. Alamat Anda tidak pernah dijual atau dibagikan.",
  subscribeDone:
    "Hampir selesai — buka email yang baru kami kirim lalu tekan konfirmasi.",
  subscribeInvalid: "Alamat itu sepertinya tidak benar.",
  subscribeTooMany:
    "Terlalu banyak pendaftaran dari sini saat ini — coba lagi beberapa menit.",
  confirmTitle: "Konfirmasi langganan Anda",
  confirmBody:
    "Tekan di bawah dan kami akan mengirimkan buletin. Tidak ada yang lain, dan tidak ada apa pun sampai Anda melakukannya.",
  confirmCta: "Ya, daftarkan saya",
  confirmedTitle: "Anda sudah terdaftar",
  confirmedBody: "Kami akan menghubungi saat ada yang layak dibaca.",
  expiredTitle: "Tautan ini sudah kedaluwarsa",
  expiredBody:
    "Tautan konfirmasi berlaku beberapa hari. Daftar lagi dan kami kirimkan yang baru.",
  mailSubject: "Konfirmasi langganan Sailo Anda",
  mailBody:
    "seseorang meminta buletin Sailo dikirim ke alamat ini. Tekan di bawah dan Anda terdaftar.",
  mailCta: "Konfirmasi langganan saya",
  mailIgnore:
    "Jika itu bukan Anda, abaikan saja email ini — tidak ada yang ditambahkan di mana pun.",
  welcomeSubject: "Anda sudah terdaftar",
  welcomeBody:
    "terima kasih sudah berlangganan. Dua kali sebulan kami kirim satu email tentang berjualan online — harga, foto, pengiriman, dan apa yang benar-benar berhasil. Semua yang sudah kami tulis menanti Anda.",
  welcomeCta: "Baca blognya",
  unsubscribe: "Berhenti berlangganan",
};

const it: BlogDictionary = {
  onThisPage: "In questa pagina",
  share: "Condividi",
  copyLink: "Copia link",
  copied: "Link copiato",
  keepReading: "Continua a leggere",
  writtenBy: "Scritto da",
  topics: "Argomenti",
  latest: "Ultimi",
  subscribeTitle: "Appunti sul vendere, due volte al mese",
  subscribeBody:
    "Un'email su prezzi, foto, spedizioni e su come farsi pagare. Niente pubblicità, niente riempitivi.",
  subscribeEmail: "Il tuo indirizzo email",
  subscribeCta: "Iscriviti",
  subscribeNote:
    "Puoi disiscriverti quando vuoi. Il tuo indirizzo non viene mai venduto né condiviso.",
  subscribeDone:
    "Ci siamo quasi — apri l'email che ti abbiamo appena mandato e tocca conferma.",
  subscribeInvalid: "Questo indirizzo non sembra corretto.",
  subscribeTooMany:
    "Troppe iscrizioni da qui in questo momento — riprova tra qualche minuto.",
  confirmTitle: "Conferma l'iscrizione",
  confirmBody:
    "Tocca qui sotto e ti manderemo la newsletter. Nient'altro, e assolutamente niente finché non lo fai.",
  confirmCta: "Sì, iscrivimi",
  confirmedTitle: "Sei nella lista",
  confirmedBody: "Ti scriveremo quando ci sarà qualcosa che vale la pena leggere.",
  expiredTitle: "Questo link è scaduto",
  expiredBody:
    "I link di conferma durano qualche giorno. Iscriviti di nuovo e te ne mandiamo uno nuovo.",
  mailSubject: "Conferma la tua iscrizione a Sailo",
  mailBody:
    "qualcuno ha chiesto di ricevere la newsletter di Sailo a questo indirizzo. Tocca qui sotto e sei nella lista.",
  mailCta: "Conferma l'iscrizione",
  mailIgnore:
    "Se non sei stato tu, ignora questa email — non è stato aggiunto nulla da nessuna parte.",
  welcomeSubject: "Sei nella lista",
  welcomeBody:
    "grazie per l'iscrizione. Due volte al mese mandiamo un'email sul vendere online — prezzi, foto, spedizioni e quello che funziona davvero. Tutto quello che abbiamo scritto finora ti aspetta.",
  welcomeCta: "Leggi il blog",
  unsubscribe: "Disiscriviti",
};

const ja: BlogDictionary = {
  onThisPage: "このページの内容",
  share: "シェア",
  copyLink: "リンクをコピー",
  copied: "リンクをコピーしました",
  keepReading: "続けて読む",
  writtenBy: "執筆",
  topics: "トピック",
  latest: "最新の記事",
  subscribeTitle: "売ることについてのノート、月2回",
  subscribeBody:
    "価格の付け方、写真、配送、そして代金の受け取りについてのメールを1通。宣伝も水増しもありません。",
  subscribeEmail: "メールアドレス",
  subscribeCta: "登録する",
  subscribeNote:
    "いつでも配信を停止できます。アドレスを販売したり共有したりすることはありません。",
  subscribeDone:
    "あと少しです — 今お送りしたメールを開いて、確認ボタンを押してください。",
  subscribeInvalid: "このアドレスは正しくないようです。",
  subscribeTooMany:
    "現在このネットワークからの登録が多すぎます — 数分後にもう一度お試しください。",
  confirmTitle: "登録の確認",
  confirmBody:
    "下のボタンを押すとニュースレターをお送りします。それ以外は何も送りませんし、押されるまでは一切送りません。",
  confirmCta: "はい、登録します",
  confirmedTitle: "登録が完了しました",
  confirmedBody: "読む価値のあることができたら、ご連絡します。",
  expiredTitle: "このリンクは期限切れです",
  expiredBody:
    "確認リンクの有効期間は数日です。もう一度登録していただければ、新しいリンクをお送りします。",
  mailSubject: "Sailo ニュースレターの登録確認",
  mailBody:
    "このアドレスで Sailo のニュースレターを受け取るリクエストがありました。下のボタンを押すと登録が完了します。",
  mailCta: "登録を確認する",
  mailIgnore:
    "心当たりがない場合は、このメールを無視してください。どこにも何も登録されていません。",
  welcomeSubject: "登録が完了しました",
  welcomeBody:
    "ご登録ありがとうございます。月に2回、オンラインで売ることについてのメールを1通お送りします — 価格、写真、配送、そして実際に効果のあること。これまでに書いた記事はすべてお読みいただけます。",
  welcomeCta: "ブログを読む",
  unsubscribe: "配信停止",
};

const ko: BlogDictionary = {
  onThisPage: "이 페이지의 내용",
  share: "공유",
  copyLink: "링크 복사",
  copied: "링크를 복사했습니다",
  keepReading: "이어서 읽기",
  writtenBy: "작성",
  topics: "주제",
  latest: "최신 글",
  subscribeTitle: "파는 일에 대한 메모, 한 달에 두 번",
  subscribeBody:
    "가격, 사진, 배송, 그리고 대금을 받는 일에 대한 메일 한 통. 홍보도 군더더기도 없습니다.",
  subscribeEmail: "이메일 주소",
  subscribeCta: "구독하기",
  subscribeNote:
    "언제든 구독을 취소할 수 있습니다. 주소를 판매하거나 공유하지 않습니다.",
  subscribeDone: "거의 다 됐습니다 — 방금 보낸 메일을 열고 확인을 눌러 주세요.",
  subscribeInvalid: "이 주소는 올바르지 않아 보입니다.",
  subscribeTooMany:
    "지금 이곳에서 가입 시도가 너무 많습니다 — 몇 분 뒤에 다시 시도해 주세요.",
  confirmTitle: "구독 확인",
  confirmBody:
    "아래를 누르면 뉴스레터를 보내 드립니다. 그 외에는 아무것도 보내지 않고, 누르기 전까지는 전혀 보내지 않습니다.",
  confirmCta: "네, 구독할게요",
  confirmedTitle: "구독이 완료되었습니다",
  confirmedBody: "읽을 만한 것이 생기면 연락드리겠습니다.",
  expiredTitle: "이 링크는 만료되었습니다",
  expiredBody:
    "확인 링크는 며칠간 유효합니다. 다시 신청하시면 새 링크를 보내 드립니다.",
  mailSubject: "Sailo 뉴스레터 구독 확인",
  mailBody:
    "이 주소로 Sailo 뉴스레터를 받겠다는 요청이 있었습니다. 아래를 누르면 구독이 완료됩니다.",
  mailCta: "구독 확인하기",
  mailIgnore:
    "본인이 아니라면 이 메일을 무시하세요 — 어디에도 아무것도 등록되지 않았습니다.",
  welcomeSubject: "구독이 완료되었습니다",
  welcomeBody:
    "구독해 주셔서 고맙습니다. 한 달에 두 번, 온라인으로 파는 일에 대한 메일을 한 통 보냅니다 — 가격, 사진, 배송, 그리고 실제로 통하는 것들. 지금까지 쓴 글이 모두 기다리고 있습니다.",
  welcomeCta: "블로그 읽기",
  unsubscribe: "구독 취소",
};

const mk: BlogDictionary = {
  onThisPage: "На оваа страница",
  share: "Сподели",
  copyLink: "Копирај врска",
  copied: "Врската е копирана",
  keepReading: "Продолжете со читање",
  writtenBy: "Напишано од",
  topics: "Теми",
  latest: "Најново",
  subscribeTitle: "Белешки за продавањето, двапати месечно",
  subscribeBody:
    "Една порака за цени, фотографии, достава и наплата. Без реклама и без полнење.",
  subscribeEmail: "Вашата е-пошта",
  subscribeCta: "Претплати ме",
  subscribeNote:
    "Откажување во секое време. Вашата адреса никогаш не се продава ниту споделува.",
  subscribeDone:
    "Речиси готово — отворете ја пораката што штотуку ја испративме и потврдете.",
  subscribeInvalid: "Оваа адреса не изгледа исправно.",
  subscribeTooMany:
    "Премногу пријави оттука во моментов — обидете се повторно за неколку минути.",
  confirmTitle: "Потврдете ја претплатата",
  confirmBody:
    "Притиснете подолу и ќе ви го испраќаме билтенот. Ништо друго, и баш ништо додека не го направите тоа.",
  confirmCta: "Да, претплати ме",
  confirmedTitle: "На списокот сте",
  confirmedBody: "Ќе се јавиме кога ќе има нешто вредно за читање.",
  expiredTitle: "Оваа врска истече",
  expiredBody:
    "Врските за потврда траат неколку дена. Пријавете се повторно и ќе испратиме нова.",
  mailSubject: "Потврдете ја претплатата на Sailo",
  mailBody:
    "некој побара билтенот на Sailo да пристигнува на оваа адреса. Притиснете подолу и сте на списокот.",
  mailCta: "Ја потврдувам претплатата",
  mailIgnore:
    "Ако тоа не сте биле вие, игнорирајте ја оваа порака — никаде ништо не е додадено.",
  welcomeSubject: "На списокот сте",
  welcomeBody:
    "благодариме за претплатата. Двапати месечно испраќаме една порака за онлајн продажба — цени, фотографии, достава и што навистина работи. Сѐ што сме напишале досега ве чека.",
  welcomeCta: "Прочитајте го блогот",
  unsubscribe: "Откажи претплата",
};

const ms: BlogDictionary = {
  onThisPage: "Dalam halaman ini",
  share: "Kongsi",
  copyLink: "Salin pautan",
  copied: "Pautan disalin",
  keepReading: "Terus membaca",
  writtenBy: "Ditulis oleh",
  topics: "Topik",
  latest: "Terkini",
  subscribeTitle: "Nota tentang berniaga, dua kali sebulan",
  subscribeBody:
    "Satu e-mel tentang harga, gambar, penghantaran dan cara dibayar. Tiada iklan, tiada pengisi.",
  subscribeEmail: "Alamat e-mel anda",
  subscribeCta: "Langgan",
  subscribeNote:
    "Berhenti bila-bila masa. Alamat anda tidak pernah dijual atau dikongsi.",
  subscribeDone:
    "Hampir siap — buka e-mel yang baru kami hantar dan tekan sahkan.",
  subscribeInvalid: "Alamat itu nampak tidak betul.",
  subscribeTooMany:
    "Terlalu banyak pendaftaran dari sini sekarang — cuba lagi dalam beberapa minit.",
  confirmTitle: "Sahkan langganan anda",
  confirmBody:
    "Tekan di bawah dan kami akan hantar buletin. Tiada apa-apa lagi, dan tiada apa-apa langsung sehingga anda berbuat demikian.",
  confirmCta: "Ya, langgankan saya",
  confirmedTitle: "Anda dalam senarai",
  confirmedBody: "Kami akan menghubungi apabila ada sesuatu yang berbaloi dibaca.",
  expiredTitle: "Pautan ini telah tamat tempoh",
  expiredBody:
    "Pautan pengesahan bertahan beberapa hari. Daftar semula dan kami hantar yang baharu.",
  mailSubject: "Sahkan langganan Sailo anda",
  mailBody:
    "seseorang meminta buletin Sailo dihantar ke alamat ini. Tekan di bawah dan anda dalam senarai.",
  mailCta: "Sahkan langganan saya",
  mailIgnore:
    "Jika bukan anda, abaikan sahaja e-mel ini — tiada apa-apa ditambah di mana-mana.",
  welcomeSubject: "Anda dalam senarai",
  welcomeBody:
    "terima kasih kerana melanggan. Dua kali sebulan kami hantar satu e-mel tentang berniaga dalam talian — harga, gambar, penghantaran, dan apa yang benar-benar berkesan. Semua yang kami tulis setakat ini menanti anda.",
  welcomeCta: "Baca blog",
  unsubscribe: "Berhenti melanggan",
};

const nl: BlogDictionary = {
  onThisPage: "Op deze pagina",
  share: "Delen",
  copyLink: "Link kopiëren",
  copied: "Link gekopieerd",
  keepReading: "Verder lezen",
  writtenBy: "Geschreven door",
  topics: "Onderwerpen",
  latest: "Nieuwste",
  subscribeTitle: "Notities over verkopen, twee keer per maand",
  subscribeBody:
    "Eén mail over prijzen, foto's, bezorging en betaald krijgen. Geen reclame, geen opvulling.",
  subscribeEmail: "Je e-mailadres",
  subscribeCta: "Aanmelden",
  subscribeNote:
    "Je kunt je altijd afmelden. Je adres wordt nooit verkocht of gedeeld.",
  subscribeDone:
    "Bijna klaar — open de mail die we net stuurden en tik op bevestigen.",
  subscribeInvalid: "Dat adres lijkt niet te kloppen.",
  subscribeTooMany:
    "Te veel aanmeldingen vanaf hier op dit moment — probeer het over een paar minuten opnieuw.",
  confirmTitle: "Bevestig je aanmelding",
  confirmBody:
    "Tik hieronder en we sturen je de nieuwsbrief. Verder niets, en helemaal niets totdat je dat doet.",
  confirmCta: "Ja, meld me aan",
  confirmedTitle: "Je staat op de lijst",
  confirmedBody: "We schrijven zodra er iets is dat het lezen waard is.",
  expiredTitle: "Deze link is verlopen",
  expiredBody:
    "Bevestigingslinks gelden een paar dagen. Meld je opnieuw aan, dan sturen we een nieuwe.",
  mailSubject: "Bevestig je Sailo-aanmelding",
  mailBody:
    "iemand vroeg om de Sailo-nieuwsbrief op dit adres. Tik hieronder en je staat op de lijst.",
  mailCta: "Mijn aanmelding bevestigen",
  mailIgnore:
    "Was jij dat niet, negeer deze mail dan — er is nergens iets toegevoegd.",
  welcomeSubject: "Je staat op de lijst",
  welcomeBody:
    "bedankt voor je aanmelding. Twee keer per maand sturen we één mail over online verkopen — prijzen, foto's, bezorging, en wat echt werkt. Alles wat we tot nu toe schreven staat voor je klaar.",
  welcomeCta: "Lees de blog",
  unsubscribe: "Afmelden",
};

const no: BlogDictionary = {
  onThisPage: "På denne siden",
  share: "Del",
  copyLink: "Kopier lenke",
  copied: "Lenke kopiert",
  keepReading: "Les videre",
  writtenBy: "Skrevet av",
  topics: "Emner",
  latest: "Nyeste",
  subscribeTitle: "Notater om å selge, to ganger i måneden",
  subscribeBody:
    "Én e-post om priser, bilder, levering og å få betalt. Ingen reklame, ingen fyll.",
  subscribeEmail: "E-postadressen din",
  subscribeCta: "Meld meg på",
  subscribeNote:
    "Meld deg av når du vil. Adressen din selges eller deles aldri.",
  subscribeDone: "Nesten der — åpne e-posten vi nettopp sendte og trykk bekreft.",
  subscribeInvalid: "Den adressen ser ikke riktig ut.",
  subscribeTooMany:
    "For mange påmeldinger herfra akkurat nå — prøv igjen om et par minutter.",
  confirmTitle: "Bekreft påmeldingen",
  confirmBody:
    "Trykk nedenfor, så sender vi nyhetsbrevet. Ingenting annet — og ingenting i det hele tatt før du gjør det.",
  confirmCta: "Ja, meld meg på",
  confirmedTitle: "Du er på listen",
  confirmedBody: "Vi tar kontakt når det er noe verdt å lese.",
  expiredTitle: "Denne lenken har utløpt",
  expiredBody:
    "Bekreftelseslenker varer noen dager. Meld deg på igjen, så sender vi en ny.",
  mailSubject: "Bekreft Sailo-påmeldingen din",
  mailBody:
    "noen ba om å få Sailos nyhetsbrev på denne adressen. Trykk nedenfor, så er du på listen.",
  mailCta: "Bekreft påmeldingen",
  mailIgnore:
    "Var det ikke deg, kan du bare se bort fra denne e-posten — ingenting er lagt til noe sted.",
  welcomeSubject: "Du er på listen",
  welcomeBody:
    "takk for at du meldte deg på. To ganger i måneden sender vi én e-post om å selge på nett — priser, bilder, levering, og hva som faktisk virker. Alt vi har skrevet så langt venter på deg.",
  welcomeCta: "Les bloggen",
  unsubscribe: "Meld av",
};

const pl: BlogDictionary = {
  onThisPage: "Na tej stronie",
  share: "Udostępnij",
  copyLink: "Kopiuj link",
  copied: "Link skopiowany",
  keepReading: "Czytaj dalej",
  writtenBy: "Napisał",
  topics: "Tematy",
  latest: "Najnowsze",
  subscribeTitle: "Notatki o sprzedawaniu, dwa razy w miesiącu",
  subscribeBody:
    "Jeden e-mail o cenach, zdjęciach, dostawie i o tym, jak dostać pieniądze. Bez reklamy i bez waty.",
  subscribeEmail: "Twój adres e-mail",
  subscribeCta: "Zapisz się",
  subscribeNote:
    "Możesz się wypisać w każdej chwili. Twojego adresu nigdy nie sprzedajemy ani nie udostępniamy.",
  subscribeDone:
    "Już prawie — otwórz wiadomość, którą właśnie wysłaliśmy, i potwierdź.",
  subscribeInvalid: "Ten adres nie wygląda poprawnie.",
  subscribeTooMany:
    "Zbyt wiele zapisów stąd w tej chwili — spróbuj ponownie za kilka minut.",
  confirmTitle: "Potwierdź subskrypcję",
  confirmBody:
    "Kliknij poniżej, a będziemy wysyłać newsletter. Nic poza tym — i zupełnie nic, dopóki tego nie zrobisz.",
  confirmCta: "Tak, zapisz mnie",
  confirmedTitle: "Jesteś na liście",
  confirmedBody: "Odezwiemy się, gdy będzie coś wartego przeczytania.",
  expiredTitle: "Ten link wygasł",
  expiredBody:
    "Linki potwierdzające działają kilka dni. Zapisz się ponownie, a wyślemy nowy.",
  mailSubject: "Potwierdź subskrypcję Sailo",
  mailBody:
    "ktoś poprosił o newsletter Sailo na ten adres. Kliknij poniżej i jesteś na liście.",
  mailCta: "Potwierdzam subskrypcję",
  mailIgnore:
    "Jeśli to nie byłeś Ty, zignoruj tę wiadomość — nigdzie nic nie zostało dodane.",
  welcomeSubject: "Jesteś na liście",
  welcomeBody:
    "dziękujemy za zapisanie się. Dwa razy w miesiącu wysyłamy jeden e-mail o sprzedaży w internecie — ceny, zdjęcia, dostawa i to, co naprawdę działa. Wszystko, co dotąd napisaliśmy, czeka na Ciebie.",
  welcomeCta: "Czytaj bloga",
  unsubscribe: "Wypisz się",
};

const pt: BlogDictionary = {
  onThisPage: "Nesta página",
  share: "Partilhar",
  copyLink: "Copiar ligação",
  copied: "Ligação copiada",
  keepReading: "Continuar a ler",
  writtenBy: "Escrito por",
  topics: "Temas",
  latest: "Mais recentes",
  subscribeTitle: "Notas sobre vender, duas vezes por mês",
  subscribeBody:
    "Um e-mail sobre preços, fotografias, entregas e receber o dinheiro. Sem publicidade e sem enchimento.",
  subscribeEmail: "O seu e-mail",
  subscribeCta: "Subscrever",
  subscribeNote:
    "Pode cancelar quando quiser. O seu endereço nunca é vendido nem partilhado.",
  subscribeDone:
    "Falta pouco — abra o e-mail que acabámos de enviar e toque em confirmar.",
  subscribeInvalid: "Esse endereço não parece correto.",
  subscribeTooMany:
    "Demasiadas inscrições daqui neste momento — tente de novo dentro de alguns minutos.",
  confirmTitle: "Confirme a sua subscrição",
  confirmBody:
    "Toque abaixo e enviamos-lhe a newsletter. Mais nada, e absolutamente nada até que o faça.",
  confirmCta: "Sim, subscrever",
  confirmedTitle: "Está na lista",
  confirmedBody: "Escrevemos quando houver algo que valha a pena ler.",
  expiredTitle: "Esta ligação expirou",
  expiredBody:
    "As ligações de confirmação duram alguns dias. Subscreva outra vez e enviamos uma nova.",
  mailSubject: "Confirme a sua subscrição da Sailo",
  mailBody:
    "alguém pediu para receber a newsletter da Sailo neste endereço. Toque abaixo e fica na lista.",
  mailCta: "Confirmar a subscrição",
  mailIgnore:
    "Se não foi você, ignore este e-mail — não foi adicionado nada em lado nenhum.",
  welcomeSubject: "Está na lista",
  welcomeBody:
    "obrigado por subscrever. Duas vezes por mês enviamos um e-mail sobre vender online — preços, fotografias, entregas e o que funciona mesmo. Tudo o que escrevemos até agora está à sua espera.",
  welcomeCta: "Ler o blogue",
  unsubscribe: "Cancelar subscrição",
};

const ro: BlogDictionary = {
  onThisPage: "Pe această pagină",
  share: "Distribuie",
  copyLink: "Copiază linkul",
  copied: "Link copiat",
  keepReading: "Continuă să citești",
  writtenBy: "Scris de",
  topics: "Subiecte",
  latest: "Cele mai noi",
  subscribeTitle: "Notițe despre vânzare, de două ori pe lună",
  subscribeBody:
    "Un e-mail despre prețuri, fotografii, livrare și încasat. Fără reclamă și fără umplutură.",
  subscribeEmail: "Adresa ta de e-mail",
  subscribeCta: "Abonează-mă",
  subscribeNote:
    "Te poți dezabona oricând. Adresa ta nu este niciodată vândută sau partajată.",
  subscribeDone:
    "Aproape gata — deschide e-mailul pe care tocmai l-am trimis și apasă confirmă.",
  subscribeInvalid: "Adresa aceasta nu pare corectă.",
  subscribeTooMany:
    "Prea multe înscrieri de aici chiar acum — încearcă din nou peste câteva minute.",
  confirmTitle: "Confirmă abonarea",
  confirmBody:
    "Apasă mai jos și îți trimitem newsletterul. Nimic altceva și absolut nimic până nu o faci.",
  confirmCta: "Da, abonează-mă",
  confirmedTitle: "Ești pe listă",
  confirmedBody: "Îți scriem când apare ceva ce merită citit.",
  expiredTitle: "Acest link a expirat",
  expiredBody:
    "Linkurile de confirmare durează câteva zile. Abonează-te din nou și trimitem unul nou.",
  mailSubject: "Confirmă abonarea la Sailo",
  mailBody:
    "cineva a cerut newsletterul Sailo pe această adresă. Apasă mai jos și ești pe listă.",
  mailCta: "Confirm abonarea",
  mailIgnore:
    "Dacă nu ai fost tu, ignoră acest e-mail — nu s-a adăugat nimic nicăieri.",
  welcomeSubject: "Ești pe listă",
  welcomeBody:
    "mulțumim pentru abonare. De două ori pe lună trimitem un e-mail despre vânzarea online — prețuri, fotografii, livrare și ce funcționează cu adevărat. Tot ce am scris până acum te așteaptă.",
  welcomeCta: "Citește blogul",
  unsubscribe: "Dezabonare",
};

const ru: BlogDictionary = {
  onThisPage: "На этой странице",
  share: "Поделиться",
  copyLink: "Скопировать ссылку",
  copied: "Ссылка скопирована",
  keepReading: "Читать дальше",
  writtenBy: "Автор",
  topics: "Темы",
  latest: "Новое",
  subscribeTitle: "Заметки о продажах, дважды в месяц",
  subscribeBody:
    "Одно письмо о ценах, фотографиях, доставке и о том, как получать деньги. Без рекламы и без воды.",
  subscribeEmail: "Ваш адрес электронной почты",
  subscribeCta: "Подписаться",
  subscribeNote:
    "Отписаться можно в любой момент. Ваш адрес никогда не продаётся и не передаётся.",
  subscribeDone:
    "Почти готово — откройте письмо, которое мы только что отправили, и подтвердите.",
  subscribeInvalid: "Этот адрес выглядит неправильно.",
  subscribeTooMany:
    "Сейчас отсюда слишком много подписок — попробуйте через несколько минут.",
  confirmTitle: "Подтвердите подписку",
  confirmBody:
    "Нажмите ниже, и мы будем присылать рассылку. Ничего больше — и вообще ничего, пока вы этого не сделаете.",
  confirmCta: "Да, подпишите меня",
  confirmedTitle: "Вы в списке",
  confirmedBody: "Напишем, когда будет что-то, что стоит прочитать.",
  expiredTitle: "Срок действия ссылки истёк",
  expiredBody:
    "Ссылки для подтверждения живут несколько дней. Подпишитесь ещё раз, и мы пришлём новую.",
  mailSubject: "Подтвердите подписку на Sailo",
  mailBody:
    "кто-то попросил присылать рассылку Sailo на этот адрес. Нажмите ниже — и вы в списке.",
  mailCta: "Подтвердить подписку",
  mailIgnore:
    "Если это были не вы, просто не отвечайте на письмо — никуда ничего не добавлено.",
  welcomeSubject: "Вы в списке",
  welcomeBody:
    "спасибо за подписку. Дважды в месяц мы отправляем одно письмо о продажах в интернете — цены, фотографии, доставка и то, что действительно работает. Всё, что мы написали до сих пор, уже ждёт вас.",
  welcomeCta: "Читать блог",
  unsubscribe: "Отписаться",
};

const sl: BlogDictionary = {
  onThisPage: "Na tej strani",
  share: "Deli",
  copyLink: "Kopiraj povezavo",
  copied: "Povezava kopirana",
  keepReading: "Nadaljujte z branjem",
  writtenBy: "Napisal",
  topics: "Teme",
  latest: "Najnovejše",
  subscribeTitle: "Zapiski o prodaji, dvakrat mesečno",
  subscribeBody:
    "Eno sporočilo o cenah, fotografijah, dostavi in plačilu. Brez oglasov in brez polnila.",
  subscribeEmail: "Vaš e-naslov",
  subscribeCta: "Naroči me",
  subscribeNote:
    "Odjava kadar koli. Vašega naslova nikoli ne prodamo niti ne delimo.",
  subscribeDone:
    "Skoraj gotovo — odprite sporočilo, ki smo ga pravkar poslali, in potrdite.",
  subscribeInvalid: "Ta naslov ni videti pravilen.",
  subscribeTooMany:
    "Trenutno je od tod preveč prijav — poskusite čez nekaj minut.",
  confirmTitle: "Potrdite naročnino",
  confirmBody:
    "Kliknite spodaj in poslali vam bomo novičnik. Nič drugega in prav nič, dokler tega ne storite.",
  confirmCta: "Da, naroči me",
  confirmedTitle: "Na seznamu ste",
  confirmedBody: "Oglasimo se, ko bo kaj vrednega branja.",
  expiredTitle: "Ta povezava je potekla",
  expiredBody:
    "Potrditvene povezave veljajo nekaj dni. Prijavite se znova in poslali bomo novo.",
  mailSubject: "Potrdite naročnino na Sailo",
  mailBody:
    "nekdo je želel prejemati novičnik Sailo na ta naslov. Kliknite spodaj in ste na seznamu.",
  mailCta: "Potrjujem naročnino",
  mailIgnore:
    "Če to niste bili vi, sporočilo prezrite — nikamor ni bilo nič dodano.",
  welcomeSubject: "Na seznamu ste",
  welcomeBody:
    "hvala za naročnino. Dvakrat mesečno pošljemo eno sporočilo o spletni prodaji — cene, fotografije, dostava in kaj v resnici deluje. Vse, kar smo doslej napisali, vas čaka.",
  welcomeCta: "Preberite blog",
  unsubscribe: "Odjava",
};

const sq: BlogDictionary = {
  onThisPage: "Në këtë faqe",
  share: "Ndaj",
  copyLink: "Kopjo lidhjen",
  copied: "Lidhja u kopjua",
  keepReading: "Vazhdo leximin",
  writtenBy: "Shkruar nga",
  topics: "Temat",
  latest: "Më të rejat",
  subscribeTitle: "Shënime për shitjen, dy herë në muaj",
  subscribeBody:
    "Një email për çmimet, fotografitë, dërgesën dhe pagesën. Pa reklama dhe pa mbushje.",
  subscribeEmail: "Adresa juaj e emailit",
  subscribeCta: "Abonohu",
  subscribeNote:
    "Mund të çabonoheni në çdo kohë. Adresa juaj nuk shitet dhe nuk ndahet kurrë.",
  subscribeDone:
    "Gati — hapni emailin që sapo dërguam dhe shtypni konfirmo.",
  subscribeInvalid: "Kjo adresë nuk duket e saktë.",
  subscribeTooMany:
    "Shumë regjistrime nga këtu për momentin — provoni sërish pas disa minutash.",
  confirmTitle: "Konfirmoni abonimin",
  confirmBody:
    "Shtypni më poshtë dhe do t'ju dërgojmë buletinin. Asgjë tjetër, dhe absolutisht asgjë derisa ta bëni.",
  confirmCta: "Po, më abono",
  confirmedTitle: "Jeni në listë",
  confirmedBody: "Do t'ju shkruajmë kur të ketë diçka që ia vlen të lexohet.",
  expiredTitle: "Kjo lidhje ka skaduar",
  expiredBody:
    "Lidhjet e konfirmimit zgjasin disa ditë. Regjistrohuni sërish dhe dërgojmë një të re.",
  mailSubject: "Konfirmoni abonimin tuaj në Sailo",
  mailBody:
    "dikush kërkoi buletinin e Sailo në këtë adresë. Shtypni më poshtë dhe jeni në listë.",
  mailCta: "Konfirmo abonimin",
  mailIgnore:
    "Nëse nuk ishit ju, shpërfilleni këtë email — nuk është shtuar asgjë askund.",
  welcomeSubject: "Jeni në listë",
  welcomeBody:
    "faleminderit që u abonuat. Dy herë në muaj dërgojmë një email për shitjen online — çmimet, fotografitë, dërgesën dhe atë që funksionon vërtet. Gjithçka që kemi shkruar deri tani ju pret.",
  welcomeCta: "Lexo blogun",
  unsubscribe: "Çabonohu",
};

const sr: BlogDictionary = {
  onThisPage: "На овој страници",
  share: "Подели",
  copyLink: "Копирај везу",
  copied: "Веза је копирана",
  keepReading: "Наставите да читате",
  writtenBy: "Написао",
  topics: "Теме",
  latest: "Најновије",
  subscribeTitle: "Белешке о продаји, двапут месечно",
  subscribeBody:
    "Једна порука о ценама, фотографијама, достави и наплати. Без реклама и без пуњења.",
  subscribeEmail: "Ваша имејл адреса",
  subscribeCta: "Пријави ме",
  subscribeNote:
    "Одјава у сваком тренутку. Ваша адреса се никада не продаје нити дели.",
  subscribeDone:
    "Скоро готово — отворите поруку коју смо управо послали и потврдите.",
  subscribeInvalid: "Та адреса не изгледа исправно.",
  subscribeTooMany:
    "Превише пријава одавде у овом тренутку — покушајте за неколико минута.",
  confirmTitle: "Потврдите претплату",
  confirmBody:
    "Кликните испод и слаћемо вам билтен. Ништа друго, и баш ништа док то не урадите.",
  confirmCta: "Да, пријави ме",
  confirmedTitle: "На списку сте",
  confirmedBody: "Јавићемо се када буде нешто вредно читања.",
  expiredTitle: "Ова веза је истекла",
  expiredBody:
    "Везе за потврду трају неколико дана. Пријавите се поново и послаћемо нову.",
  mailSubject: "Потврдите претплату на Sailo",
  mailBody:
    "неко је затражио Sailo билтен на ову адресу. Кликните испод и на списку сте.",
  mailCta: "Потврђујем претплату",
  mailIgnore:
    "Ако то нисте били ви, занемарите ову поруку — нигде ништа није додато.",
  welcomeSubject: "На списку сте",
  welcomeBody:
    "хвала на претплати. Двапут месечно шаљемо једну поруку о онлајн продаји — цене, фотографије, достава и оно што заиста функционише. Све што смо до сада написали чека вас.",
  welcomeCta: "Прочитајте блог",
  unsubscribe: "Одјава",
};

const sv: BlogDictionary = {
  onThisPage: "På den här sidan",
  share: "Dela",
  copyLink: "Kopiera länk",
  copied: "Länk kopierad",
  keepReading: "Läs vidare",
  writtenBy: "Skriven av",
  topics: "Ämnen",
  latest: "Senaste",
  subscribeTitle: "Anteckningar om att sälja, två gånger i månaden",
  subscribeBody:
    "Ett mejl om priser, bilder, leverans och att få betalt. Ingen reklam, ingen utfyllnad.",
  subscribeEmail: "Din e-postadress",
  subscribeCta: "Prenumerera",
  subscribeNote:
    "Avsluta när du vill. Din adress säljs eller delas aldrig.",
  subscribeDone: "Nästan klart — öppna mejlet vi just skickade och tryck bekräfta.",
  subscribeInvalid: "Den adressen ser inte rätt ut.",
  subscribeTooMany:
    "För många anmälningar härifrån just nu — försök igen om några minuter.",
  confirmTitle: "Bekräfta din prenumeration",
  confirmBody:
    "Tryck nedan så skickar vi nyhetsbrevet. Inget annat — och ingenting alls förrän du gör det.",
  confirmCta: "Ja, anmäl mig",
  confirmedTitle: "Du är med på listan",
  confirmedBody: "Vi hör av oss när det finns något värt att läsa.",
  expiredTitle: "Den här länken har gått ut",
  expiredBody:
    "Bekräftelselänkar gäller några dagar. Anmäl dig igen så skickar vi en ny.",
  mailSubject: "Bekräfta din Sailo-prenumeration",
  mailBody:
    "någon bad om att få Sailos nyhetsbrev till den här adressen. Tryck nedan så är du med på listan.",
  mailCta: "Bekräfta min prenumeration",
  mailIgnore:
    "Var det inte du kan du strunta i det här mejlet — ingenting har lagts till någonstans.",
  welcomeSubject: "Du är med på listan",
  welcomeBody:
    "tack för att du prenumererar. Två gånger i månaden skickar vi ett mejl om att sälja på nätet — priser, bilder, leverans och vad som faktiskt fungerar. Allt vi skrivit hittills väntar på dig.",
  welcomeCta: "Läs bloggen",
  unsubscribe: "Avsluta prenumeration",
};

const th: BlogDictionary = {
  onThisPage: "ในหน้านี้",
  share: "แชร์",
  copyLink: "คัดลอกลิงก์",
  copied: "คัดลอกลิงก์แล้ว",
  keepReading: "อ่านต่อ",
  writtenBy: "เขียนโดย",
  topics: "หัวข้อ",
  latest: "ล่าสุด",
  subscribeTitle: "บันทึกเรื่องการขาย เดือนละสองครั้ง",
  subscribeBody:
    "อีเมลฉบับเดียวเรื่องการตั้งราคา ภาพถ่าย การจัดส่ง และการรับเงิน ไม่มีโฆษณา ไม่มีน้ำ",
  subscribeEmail: "อีเมลของคุณ",
  subscribeCta: "สมัครรับข่าว",
  subscribeNote:
    "ยกเลิกได้ทุกเมื่อ เราไม่ขายและไม่แชร์อีเมลของคุณ",
  subscribeDone: "อีกนิดเดียว — เปิดอีเมลที่เราเพิ่งส่งไปแล้วกดยืนยัน",
  subscribeInvalid: "อีเมลนี้ดูไม่ถูกต้อง",
  subscribeTooMany:
    "ตอนนี้มีการสมัครจากที่นี่มากเกินไป — ลองใหม่อีกครั้งในอีกไม่กี่นาที",
  confirmTitle: "ยืนยันการสมัคร",
  confirmBody:
    "กดด้านล่างแล้วเราจะส่งจดหมายข่าวให้ ไม่มีอย่างอื่น และจะไม่ส่งอะไรเลยจนกว่าคุณจะกด",
  confirmCta: "ใช่ สมัครเลย",
  confirmedTitle: "คุณอยู่ในรายชื่อแล้ว",
  confirmedBody: "เราจะติดต่อไปเมื่อมีเรื่องที่ควรค่าแก่การอ่าน",
  expiredTitle: "ลิงก์นี้หมดอายุแล้ว",
  expiredBody:
    "ลิงก์ยืนยันมีอายุไม่กี่วัน สมัครอีกครั้งแล้วเราจะส่งลิงก์ใหม่ให้",
  mailSubject: "ยืนยันการสมัครรับข่าวจาก Sailo",
  mailBody:
    "มีคนขอรับจดหมายข่าวของ Sailo ที่อีเมลนี้ กดด้านล่างแล้วคุณจะอยู่ในรายชื่อ",
  mailCta: "ยืนยันการสมัคร",
  mailIgnore:
    "ถ้าไม่ใช่คุณ ให้ข้ามอีเมลนี้ไปได้เลย — ยังไม่มีการเพิ่มอะไรที่ไหนทั้งสิ้น",
  welcomeSubject: "คุณอยู่ในรายชื่อแล้ว",
  welcomeBody:
    "ขอบคุณที่สมัครรับข่าว เดือนละสองครั้งเราจะส่งอีเมลฉบับเดียวเรื่องการขายออนไลน์ — ราคา ภาพถ่าย การจัดส่ง และสิ่งที่ได้ผลจริง ทุกอย่างที่เราเขียนไว้รออยู่แล้ว",
  welcomeCta: "อ่านบล็อก",
  unsubscribe: "ยกเลิกการรับข่าว",
};

const tr: BlogDictionary = {
  onThisPage: "Bu sayfada",
  share: "Paylaş",
  copyLink: "Bağlantıyı kopyala",
  copied: "Bağlantı kopyalandı",
  keepReading: "Okumaya devam et",
  writtenBy: "Yazan",
  topics: "Konular",
  latest: "En yeniler",
  subscribeTitle: "Satmak üzerine notlar, ayda iki kez",
  subscribeBody:
    "Fiyatlandırma, fotoğraf, teslimat ve para almak üzerine tek bir e-posta. Reklam yok, dolgu yok.",
  subscribeEmail: "E-posta adresiniz",
  subscribeCta: "Abone ol",
  subscribeNote:
    "İstediğiniz zaman çıkabilirsiniz. Adresiniz asla satılmaz ya da paylaşılmaz.",
  subscribeDone:
    "Neredeyse tamam — az önce gönderdiğimiz e-postayı açıp onaylayın.",
  subscribeInvalid: "Bu adres doğru görünmüyor.",
  subscribeTooMany:
    "Şu anda buradan çok fazla kayıt geliyor — birkaç dakika sonra tekrar deneyin.",
  confirmTitle: "Aboneliğinizi onaylayın",
  confirmBody:
    "Aşağıya dokunun, bültenimizi gönderelim. Başka hiçbir şey ve siz onaylayana kadar hiçbir şey.",
  confirmCta: "Evet, abone et",
  confirmedTitle: "Listedesiniz",
  confirmedBody: "Okumaya değer bir şey olduğunda size yazacağız.",
  expiredTitle: "Bu bağlantının süresi doldu",
  expiredBody:
    "Onay bağlantıları birkaç gün geçerlidir. Yeniden kaydolun, size yenisini gönderelim.",
  mailSubject: "Sailo aboneliğinizi onaylayın",
  mailBody:
    "biri bu adrese Sailo bültenini istedi. Aşağıya dokunun ve listeye girin.",
  mailCta: "Aboneliğimi onayla",
  mailIgnore:
    "Siz değilseniz bu e-postayı yok sayın — hiçbir yere hiçbir şey eklenmedi.",
  welcomeSubject: "Listedesiniz",
  welcomeBody:
    "abone olduğunuz için teşekkürler. Ayda iki kez internetten satmak üzerine tek bir e-posta gönderiyoruz — fiyatlar, fotoğraflar, teslimat ve gerçekten işe yarayanlar. Şimdiye kadar yazdığımız her şey sizi bekliyor.",
  welcomeCta: "Blogu oku",
  unsubscribe: "Abonelikten çık",
};

const uk: BlogDictionary = {
  onThisPage: "На цій сторінці",
  share: "Поділитися",
  copyLink: "Скопіювати посилання",
  copied: "Посилання скопійовано",
  keepReading: "Читати далі",
  writtenBy: "Автор",
  topics: "Теми",
  latest: "Найновіше",
  subscribeTitle: "Нотатки про продаж, двічі на місяць",
  subscribeBody:
    "Один лист про ціни, фотографії, доставку та про те, як отримувати гроші. Без реклами й без води.",
  subscribeEmail: "Ваша електронна адреса",
  subscribeCta: "Підписатися",
  subscribeNote:
    "Відписатися можна будь-коли. Вашу адресу ніколи не продають і не передають.",
  subscribeDone:
    "Майже готово — відкрийте лист, який ми щойно надіслали, і підтвердьте.",
  subscribeInvalid: "Ця адреса виглядає неправильно.",
  subscribeTooMany:
    "Зараз звідси надто багато підписок — спробуйте за кілька хвилин.",
  confirmTitle: "Підтвердьте підписку",
  confirmBody:
    "Натисніть нижче, і ми надсилатимемо розсилку. Нічого іншого — і взагалі нічого, доки ви цього не зробите.",
  confirmCta: "Так, підпишіть мене",
  confirmedTitle: "Ви у списку",
  confirmedBody: "Напишемо, коли буде щось варте прочитання.",
  expiredTitle: "Термін дії посилання вичерпано",
  expiredBody:
    "Посилання для підтвердження живуть кілька днів. Підпишіться ще раз — надішлемо нове.",
  mailSubject: "Підтвердьте підписку на Sailo",
  mailBody:
    "хтось попросив надсилати розсилку Sailo на цю адресу. Натисніть нижче — і ви у списку.",
  mailCta: "Підтвердити підписку",
  mailIgnore:
    "Якщо це були не ви, просто проігноруйте лист — нікуди нічого не додано.",
  welcomeSubject: "Ви у списку",
  welcomeBody:
    "дякуємо за підписку. Двічі на місяць надсилаємо один лист про продаж в інтернеті — ціни, фотографії, доставка і те, що справді працює. Усе, що ми написали досі, уже чекає на вас.",
  welcomeCta: "Читати блог",
  unsubscribe: "Відписатися",
};

const vi: BlogDictionary = {
  onThisPage: "Trong trang này",
  share: "Chia sẻ",
  copyLink: "Sao chép liên kết",
  copied: "Đã sao chép liên kết",
  keepReading: "Đọc tiếp",
  writtenBy: "Viết bởi",
  topics: "Chủ đề",
  latest: "Mới nhất",
  subscribeTitle: "Ghi chép về việc bán hàng, hai lần mỗi tháng",
  subscribeBody:
    "Một email về giá, ảnh chụp, giao hàng và chuyện nhận tiền. Không quảng cáo, không lấp chỗ trống.",
  subscribeEmail: "Địa chỉ email của bạn",
  subscribeCta: "Đăng ký",
  subscribeNote:
    "Hủy bất cứ lúc nào. Địa chỉ của bạn không bao giờ bị bán hay chia sẻ.",
  subscribeDone:
    "Gần xong rồi — mở email chúng tôi vừa gửi và nhấn xác nhận.",
  subscribeInvalid: "Địa chỉ này trông không đúng.",
  subscribeTooMany:
    "Hiện có quá nhiều lượt đăng ký từ đây — thử lại sau vài phút.",
  confirmTitle: "Xác nhận đăng ký",
  confirmBody:
    "Nhấn bên dưới và chúng tôi sẽ gửi bản tin. Không gì khác, và hoàn toàn không gì cho đến khi bạn nhấn.",
  confirmCta: "Vâng, đăng ký cho tôi",
  confirmedTitle: "Bạn đã có trong danh sách",
  confirmedBody: "Chúng tôi sẽ viết cho bạn khi có điều gì đáng đọc.",
  expiredTitle: "Liên kết này đã hết hạn",
  expiredBody:
    "Liên kết xác nhận chỉ dùng được vài ngày. Đăng ký lại và chúng tôi sẽ gửi liên kết mới.",
  mailSubject: "Xác nhận đăng ký bản tin Sailo",
  mailBody:
    "có người yêu cầu nhận bản tin Sailo tại địa chỉ này. Nhấn bên dưới và bạn sẽ có trong danh sách.",
  mailCta: "Xác nhận đăng ký",
  mailIgnore:
    "Nếu không phải bạn, hãy bỏ qua email này — chưa có gì được thêm vào đâu cả.",
  welcomeSubject: "Bạn đã có trong danh sách",
  welcomeBody:
    "cảm ơn bạn đã đăng ký. Hai lần mỗi tháng chúng tôi gửi một email về việc bán hàng trực tuyến — giá, ảnh chụp, giao hàng, và điều gì thực sự hiệu quả. Tất cả những gì chúng tôi đã viết đang chờ bạn.",
  welcomeCta: "Đọc blog",
  unsubscribe: "Hủy đăng ký",
};

const zh: BlogDictionary = {
  onThisPage: "本页内容",
  share: "分享",
  copyLink: "复制链接",
  copied: "链接已复制",
  keepReading: "继续阅读",
  writtenBy: "作者",
  topics: "主题",
  latest: "最新",
  subscribeTitle: "关于卖东西的笔记，每月两封",
  subscribeBody:
    "一封邮件，讲定价、拍照、配送和收钱。没有推销，也没有废话。",
  subscribeEmail: "你的邮箱地址",
  subscribeCta: "订阅",
  subscribeNote: "随时可以退订。我们绝不出售或分享你的邮箱。",
  subscribeDone: "就快好了——打开我们刚发的邮件，点一下确认。",
  subscribeInvalid: "这个地址看起来不太对。",
  subscribeTooMany: "此处目前注册太频繁——请过几分钟再试。",
  confirmTitle: "确认订阅",
  confirmBody:
    "点击下方，我们就会把通讯寄给你。除此之外什么都不寄，在你点击之前更是一封也不寄。",
  confirmCta: "是的，帮我订阅",
  confirmedTitle: "你已在名单上",
  confirmedBody: "有值得一读的内容时，我们会联系你。",
  expiredTitle: "此链接已过期",
  expiredBody: "确认链接只有几天有效期。再订阅一次，我们会重新发一封给你。",
  mailSubject: "确认订阅 Sailo 通讯",
  mailBody: "有人请求把 Sailo 的通讯寄到这个地址。点击下方，你就在名单上了。",
  mailCta: "确认我的订阅",
  mailIgnore: "如果不是你，忽略这封邮件即可——任何地方都还没有添加任何内容。",
  welcomeSubject: "你已在名单上",
  welcomeBody:
    "谢谢你订阅。每月两次，我们会寄一封关于线上卖东西的邮件——定价、拍照、配送，以及真正管用的做法。我们至今写下的一切都在等你。",
  welcomeCta: "阅读博客",
  unsubscribe: "退订",
};

/**
 * Every shipped language, checked by the type rather than by a reviewer.
 *
 * `Record<Locale, …>` is the whole reason this lives in one file: adding a
 * locale to `config.ts` breaks this line until somebody writes the strings,
 * which is exactly when they should be written.
 */
const DICTIONARIES: Record<Locale, BlogDictionary> = {
  en,
  ar,
  bg,
  bs,
  cs,
  da,
  de,
  el,
  es,
  fi,
  fil,
  fr,
  hr,
  hu,
  id,
  it,
  ja,
  ko,
  mk,
  ms,
  nl,
  no,
  pl,
  pt,
  ro,
  ru,
  sl,
  sq,
  sr,
  sv,
  th,
  tr,
  uk,
  vi,
  zh,
};

/**
 * The blog's chrome in one language.
 *
 * `isLocale` rather than a bare index, because the locale reaches this from a
 * URL segment and from a signed token, and an unchecked lookup would return
 * `undefined` and crash a page rather than showing it in English.
 */
export function getBlogDictionary(locale: string): BlogDictionary {
  return isLocale(locale) ? DICTIONARIES[locale] : DICTIONARIES[DEFAULT_LOCALE];
}
