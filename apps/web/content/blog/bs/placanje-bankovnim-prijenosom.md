---
title: "Naplata bankovnim prijenosom, od podataka računa do potvrde da je stiglo"
description: "Broj računa je lakši dio. Teži su svrha doznake, izvod sa sedam istih iznosa i pitanje kako uopšte znaš da je uplata tvog kupca stvarno legla."
date: 2026-08-06
author: Sailo team
cover: /blog/covers/placanje-bankovnim-prijenosom.svg
coverAlt: "Ekran mobilne banke sa listom uplata pored bilježnice sa upisanim brojevima narudžbi"
tags: [naplata, bankovni prijenos, narudžbe]
---

„Poslala sam mu broj računa u ponedjeljak. Danas je četvrtak i ja stvarno ne znam je li taj čovjek uplatio ili nije."

Bankovni prijenos je najjeftiniji način naplate koji imaš, jer kroz njega niko ne uzima proviziju od tvoje robe. Sailo tu ne dodiruje novac i ne uzima ništa. Ali ima cijenu koja se ne plaća u markama nego u tvom vremenu, i cijela ta cijena se svodi na jednu stvar: ti si taj ko potvrđuje da je uplata stigla. Niko to ne radi umjesto tebe, i nijedan plan to ne mijenja.

Sistem koji radi ima tri dijela. Tačni podaci, oznaka po kojoj prepoznaješ ko je šta platio, i jedno vrijeme u danu kad otvaraš izvod.

Da odmah raščistimo zašto uopšte pričamo o prijenosu umjesto o kartici. Sailo kartično plaćanje ide preko Stripea, a provjereno 6. augusta 2026. na stripe.com/global, Bosna i Hercegovina nije na Stripeovoj listi podržanih zemalja. Karticu na svojoj stranici ne možeš dobiti ni po koju cijenu. Nemoj uzimati Business plan, {{business_monthly}} dolara mjesečno ili {{business_yearly}} godišnje, misleći da ćeš time otključati dugme za karticu, jer nećeš. Provjeri i sam na stripe.com/global, jer se ta lista mijenja.

Prijenos i pouzeće su ono s čime radiš. Hajmo onda ozbiljno o prijenosu.

## Šta ide u koje polje

Sailo ima šest polja za bankovni prijenos:

| Polje | Šta upisuješ | Gdje se griješi |
| --- | --- | --- |
| Naziv banke | puno ime banke | skraćenice koje kupac ne prepozna |
| Ime vlasnika računa | tačno kako piše u banci | nadimak umjesto imena iz dokumenata |
| Broj računa | domaći broj računa | jedna cifra, prekucana |
| IBAN | za uplate iz inostranstva | preskočeno, pa dijaspora ne može platiti |
| SWIFT/BIC | kod tvoje banke | isto, preskočeno |
| Upute za plaćanje | slobodan tekst | ostane prazno |

Jedna stvar koju moraš znati o svim ovim poljima: to je običan tekst i niko ga ne provjerava. Sailo ne zna je li tvoj broj računa tačan, ne može ga provjeriti kod banke i neće ti reći da si pogriješila. Ako si prekucala jednu cifru, ta cifra ostaje pogrešna sve dok je ti ne primijetiš, a primijetićeš je tako što ti se troje ljudi javi da im nalog ne prolazi.

Prekopiraj podatke iz mobilne banke, nemoj ih kucati napamet. Onda ih pročitaj naglas i uporedi. Dvije minute.

### Ime vlasnika računa nije formalnost

Ovo je mala zemlja i ljudi su oprezni. Kupac koji te zna kao „Keramika Dženana" sa Instagrama, a u nalogu vidi ime i prezime koje nikad nije čuo, stane i razmisli. Dio njih odustane i ne javi ti zašto.

Ako se ime na računu razlikuje od imena radnje, napiši to u upute jednom rečenicom. „Račun glasi na moje ime i prezime, to je isto." Time si riješila polovinu odustajanja koja nikad ne bi ni vidjela.

## Slobodan tekst je najvažnije polje

Polje za upute je jedino gdje možeš objasniti šta kupac treba uraditi. Ostalo su brojevi.

Napiši četiri stvari, kratko:

1. **Tačan iznos.** Sa markama, bez zaokruživanja naviše.
2. **Šta upisati u svrhu doznake.** Ovo je najvažniji red u cijelom polju.
3. **Rok.** Koliko dugo držiš robu rezervisanu. Dva dana je pošteno i dovoljno.
4. **Šta se dešava poslije.** Da ćeš javiti kad vidiš uplatu i kad šalješ.

Rečenica koja radi izgleda otprilike ovako: „U svrhu doznake upiši broj narudžbe koji ti je stigao u poruci. Rezervišem robu 48 sati. Kad vidim uplatu, javljam ti i šaljem isti ili sljedeći radni dan."

Kad pišeš rok, računaj radne dane, ne kalendarske. Narudžba koja stigne u petak navečer sjeda na izvod tek u ponedjeljak, ponekad i u utorak, i to nije ničija greška nego način na koji se nalozi obrađuju. Ako si napisala 48 sati bez te ograde, u nedjelju ćeš imati kupca koji misli da si mu prodala njegov komad nekom drugom, a ti ćeš imati robu koju držiš za nekoga ko je uredno platio u petak. Dopiši dvije riječi: radna dana.

Ono što ne ide u to polje: objašnjenja o porezima, obećanja o rokovima kurira i bilo kakva rečenica o naknadama koje naplaćuje banka. Naknade zavise od banke i od toga odakle uplata dolazi, pa umjesto cifre napiši gdje se to provjerava, u cjenovniku banke.

## Oznaka narudžbe je cijeli sistem

Ovo je dio zbog kojeg sam napisao ovaj tekst.

Redoslijed je bitan i skoro svi ga urade naopako. Prvo dodijeli narudžbi oznaku, pa tek onda pošalji podatke računa. Ako pošalješ broj računa prije nego što si narudžbi dala oznaku, kupac uplati bez ičega u svrsi doznake, i ti onda gledaš u izvod sa sedam uplata od po 32 KM i nemaš pojma koja je čija.

Oznaka ne mora biti pametna. Datum i dva slova imena rade posao. Petog augusta, Dženana, treća narudžba tog dana: `0508-DZ3`. Kupac to prekopira u svrhu doznake i ti ga na izvodu nađeš za tri sekunde.

> Bez oznake u svrsi doznake, izvod ti je spisak iznosa. Sa oznakom, to je lista narudžbi.

Kad se kupci ne drže toga, a neki se neće držati, ostaje ti drugi trag: ime uplatioca. Zato u trenutku kad kupac naruči, pitaj ga na čije ime ide uplata ako nije njegovo. Muž, otac, prijateljica iz Beča. To pitanje traje sekundu, a bez njega tražiš uplatu koja je legla pod imenom koje nikad nisi vidjela.

## Dženana, Mostar, keramika

Dženana pravi keramiku u Mostaru. Šolja 25 KM, tanjir 45 KM, set od šest šolja 130 KM.

U julu je imala 28 narudžbi. Devetnaest pouzećem, devet prijenosom. Prijenosom su išle uglavnom veće narudžbe, setovi i narudžbe iz inostranstva, prosjek te devetorke bio je 96 KM naspram 34 KM koliko je bio prosjek pouzeća.

To je obrazac koji se ponavlja kod skoro svih: pouzeće ti nosi broj narudžbi, prijenos ti nosi vrijednost. Čovjek koji naručuje set od 130 KM radije uplati unaprijed nego da nosi toliko gotovine na vrata.

Dženani su dvije narudžbe iz jula došle iz Austrije. Zbog toga su joj IBAN i SWIFT/BIC bili popunjeni, i zbog toga te dvije narudžbe nisu propale. Da su ta polja bila prazna, ona bi te podatke tražila po porukama, dva dana kasnije, kad je čovjek već odustao.

Ako imaš bilo kakvu vezu sa dijasporom, a u BiH je skoro svako ima, popuni ta dva polja i prije nego što ti prvi put zatrebaju.

## Kako zapravo znaš da je uplata stigla

Samo tvoja banka to zna. Sailo ti to ne može reći, ne gleda tvoj račun i nema način da ga gleda. Otvoriš mobilnu banku, vidiš uplatu, pa se vratiš u narudžbe i označiš je kao plaćenu. Ručno, svaki put.

Zato je vrijeme provjere bitno. Odaberi jedno doba dana i drži se ga. Recimo svako veče u devet. Otvoriš izvod, prođeš kroz nove uplate, poredaš ih po oznakama i označiš narudžbe. Petnaest minuta, jednom dnevno.

Provjeravanje deset puta na dan djeluje savjesno, a zapravo ti pojede sat vremena po danu i ne ubrza ništa, jer nalozi ionako sjedaju u talasima.

### Šta jeste dokaz, a šta nije

| Ovo | Znači |
| --- | --- |
| Uplata vidljiva na tvom izvodu | novac je tvoj, šalji |
| Screenshot naloga iz aplikacije | čovjek je popunio nalog, ništa više |
| Screenshot sa oznakom „u obradi" | nije još otišlo, može se i stornirati |
| Poruka „uplatio sam jutros" | vjerovatno tačno, ali nije potvrda |
| Uplata legla pa vraćena | dešava se, i vidiš tek na izvodu |

Screenshot nije dokaz. Nije zato što je kupac lopov, nego zato što nalog može biti u obradi, može biti odbijen zbog pokrića, i može biti na pogrešan račun. Kupac u dobroj namjeri ti pošalje sliku i iskreno vjeruje da je platio.

Zato se ne svađaj oko slike. Traži ono što je stvarno rješava.

## Šta napisati kad kupac kaže da je platio, a ti ne vidiš

Ovo je razgovor koji ćeš voditi svakog mjeseca, pa vrijedi imati gotovu rečenicu.

„Hvala, kod mene još nije evidentirano. Nalozi između banaka znaju kasniti, posebno preko vikenda. Možeš mi poslati potvrdu iz aplikacije, i čim vidim uplatu, šaljem isti dan. Robu ti držim."

Tri stvari koje ta poruka radi. Ne optužuje čovjeka. Daje mu konkretan sljedeći korak. I ostavlja robu rezervisanu, što je jedina stvar koja ga zapravo zanima.

Ako i poslije dva radna dana nema ništa, pitaj za tačno vrijeme naloga i ime uplatioca. Devet od deset slučajeva se tu riješi, jer se ispostavi da je uplata otišla pod imenom njegove supruge ili da je nalog ostao nepotpisan u aplikaciji.

Deseti se ne riješi. Taj je razlog zašto rezervaciju držiš 48 sati, a ne neodređeno.

## Kad iznos ne odgovara

Manjak od dvije marke se najčešće ne tiče kupca. Naknada je uzeta usput, i to zavisi od banaka kroz koje je nalog prošao.

Praktično pravilo: ako je razlika sitna i vidi se da je čovjek unio pun iznos, pošalji robu i ne spominji to. Ako se isti manjak ponavlja kod svih uplata, to nije greška nego naknada, i tada u upute dopiši ko je snosi. Ne piši koliko iznosi, jer ne iznosi isto svima, nego napiši gdje kupac to vidi.

Višak vrati. Zvuči kao sitnica, ali čovjek kojem si vratila sedam maraka pamti to duže nego popust.

## Pola unaprijed, ostatak pouzećem

Ovo je kombinacija koja kod nas rješava najviše problema, a skoro je niko ne koristi.

Za sve iznad nekih 40 KM zamoli kupca da uplati dio unaprijed na račun, a ostatak da plati kuriru na vratima. Ne mora biti tačno pola. Kod Dženane je to bilo 30 KM na set od 130 KM.

Efekat je nesrazmjeran iznosu. Čovjek koji je poslao 30 KM ne odbija paket na vratima, ne odlazi na more zaboravivši da je nešto naručio i javi ti ako mu se promijeni adresa. Rezervacija koja te ništa ne košta postane rezervacija koja njega nešto košta, i to je cijela razlika.

Kad to nudiš, formuliši kao pogodnost, ne kao nepovjerenje. „Za setove uzimam 30 KM unaprijed da rezervišem komade, ostatak platiš kuriru." Niko se na to nije naljutio.

Jedna zamka. Ako radiš na ovaj način, u bilješke o dostavi obavezno upiši koliko kurir naplaćuje, jer je to sada manji iznos od cijene artikla. Kurir naplati ono što piše u tvom nalogu, a ne ono što se vas dvoje dogovorili u porukama.

## Uplate iz inostranstva sjedaju drugačije

Rođak iz Frankfurta uplati 100 eura, a na tvoj račun legne iznos koji nije okrugao i nije baš ono što je on poslao.

Dva razloga. Konverzija se dešava kod banke po kursu koji ta banka primjenjuje tog dana, a posredničke banke na putu znaju uzeti svoje. Ni jedan ni drugi iznos ne možeš predvidjeti unaprijed, i nemoj pokušavati, nego pitaj svoju banku kako to kod njih ide.

Praktično, to znači dvije stvari. Prvo, za narudžbe iz inostranstva dogovori iznos u markama i reci kupcu da pošalje protivvrijednost, jer inače vas dvoje računate različite brojeve. Drugo, ne obećavaj slanje isti dan, jer ovakve uplate umiju stajati par radnih dana duže nego domaće.

I upiši IBAN i SWIFT/BIC prije nego ti zatrebaju. Kupac iz Beča koji te pita za te podatke, pa čeka dan i po na odgovor, više se ne javi.

## Šta ovaj kanal ne može

Sailo ne zna kad ti je novac stigao i ne može te obavijestiti.

Podaci računa su slobodan tekst koji niko ne provjerava, pa pogrešna cifra ostaje pogrešna dok je sama ne uočiš.

I nema automatskog usklađivanja između uplata i narudžbi. Ti spajaš izvod i listu narudžbi, rukom, jednom dnevno.

Ako ti se to čini kao previše posla za tvoj obim, možda ti prijenos i nije glavni kanal. Za manje iznose je pouzeće jednostavnije za kupca i za tebe, a kako se ono naplaćuje i gdje se tu gubi novac, razloženo je u tekstu o [pouzeću iz ugla prodavca](/bs/blog/pouzecem-za-prodavce).

## Šta uraditi danas

1. Otvori mobilnu banku i prekopiraj broj računa, IBAN i SWIFT/BIC u polja. Nemoj kucati napamet.
2. Napiši upute u četiri reda: iznos, šta ide u svrhu doznake, rok od 48 sati, i šta radiš kad vidiš uplatu.
3. Odaberi vrijeme kad svaki dan gledaš izvod i upiši ga sebi u telefon kao podsjetnik.
4. Za sljedeću narudžbu prvo dodijeli oznaku, pa onda pošalji podatke.

Kad to proradi, ostatak postavke radnje, od kanala do recenzija, stoji u tekstu o [prodaji online bez web stranice](/bs/blog/prodaja-online-bez-web-stranice).
