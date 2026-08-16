---
title: Per Überweisung bezahlt werden
description: Wie du als kleiner Verkäufer Überweisungen annimmst, ohne den Überblick zu verlieren, und was du machst, wenn das Geld nicht oder falsch ankommt.
date: 2026-08-06
author: Sailo team
cover: /blog/covers/per-ueberweisung-bezahlt-werden.svg
coverAlt: Ein Kontoauszug mit einer markierten Zeile
tags: [zahlungen, ueberweisung, deutschland]
---

"Er schreibt, er hat gestern überwiesen. Auf meinem Konto ist nichts, und jetzt fragt er, wann das Paket rausgeht."

Das ist die Situation, in der fast jeder kleine Verkäufer irgendwann steht, und sie hat nichts mit Vertrauen zu tun. Sie hat damit zu tun, dass zwischen "ich habe den Auftrag abgeschickt" und "das Geld ist gebucht" bei einer normalen Überweisung meistens ein Bankarbeitstag liegt, manchmal mehr, wenn ein Wochenende oder ein Feiertag dazwischen fällt.

Die Antwort auf die Frage im Titel ist kurz: Du gibst Bankverbindung und einen kurzen Verwendungszweck an, du versendest erst nach Zahlungseingang auf deinem eigenen Konto, und du machst dir eine Regel, wie lange du wartest. Das ist alles. Der Rest dieses Textes ist der Teil, der über Woche drei entscheidet, wenn du nicht mehr zwei Bestellungen hast, sondern vierzehn, und drei davon offen sind.

Und vorweg, weil es die Rechnung verändert: Bei Überweisung nimmt Sailo nichts. Null Prozent, in jedem Tarif, auch im kostenlosen für 0 Dollar. Das Geld geht direkt von seinem Konto auf deins und läuft nie durch Sailo. Bei Kartenzahlung sieht das anders aus, dazu weiter unten.

## Warum Überweisung hier eine echte Zahlart ist

In vielen Märkten ist die Überweisung der Notausgang, wenn die Karte nicht klappt. In Deutschland ist sie eine normale erste Wahl, auch bei Privatpersonen, auch bei kleinen Beträgen, auch bei Leuten unter dreißig.

Das ist ein Vorteil, den du nutzen solltest, statt gegen ihn anzukämpfen. Ein deutscher Käufer, der eine IBAN und einen Verwendungszweck sieht, weiß sofort, was er tun soll. Er braucht keine Kartendaten, kein Konto bei einem Anbieter, keine App, die er erst installieren muss. Er öffnet sein Banking, tippt ab, fertig.

Der Nachteil ist genauso konkret: Es passiert nichts automatisch. Niemand sagt dir, dass gezahlt wurde. Kein Webhook, kein grüner Haken. Du guckst nach.

## Der einzige Satz, der zählt

Dein Kontoauszug ist die Wahrheit. Nichts anderes.

Nicht der Screenshot, den dir jemand schickt. Nicht die Mail von der Bank des Käufers. Nicht die Aussage "ist raus". Ein Überweisungsauftrag kann storniert, zurückgeholt oder schlicht nie abgeschickt worden sein, und ein Screenshot lässt sich in dreißig Sekunden fälschen, ohne besondere Fähigkeiten.

Das ist keine Unterstellung gegenüber deinen Käufern. Es ist eine Regel, die du einmal aufstellst, damit du sie nicht bei jedem einzelnen Fall neu verhandeln musst, und damit du nicht derjenige bist, der bei einem netten Käufer eine Ausnahme macht und bei einem unsympathischen nicht.

> Ein Screenshot ist ein Versprechen. Ein Kontoauszug ist eine Zahlung.

## Was du in Sailo einträgst

Bei den Zahlungsarten gibt es für Überweisung diese Felder:

| Feld | Was reingehört |
|---|---|
| Bankname | Der Name deiner Bank, damit der Käufer sieht, dass es plausibel ist |
| Kontoinhaber | Exakt so, wie er bei deiner Bank steht |
| Kontonummer | Falls du sie zusätzlich angeben willst |
| IBAN | Die vollständige IBAN, mit Leerzeichen ist in Ordnung |
| BIC | Innerhalb Deutschlands meist verzichtbar, schadet aber nicht |
| Hinweistext | Freier Text, den der Käufer nach der Bestellung sieht |

Das Hinweistextfeld ist das wichtigste davon, und es ist das, das die meisten leer lassen. Da gehört rein, was der Käufer tun soll, in der Reihenfolge, in der er es tun soll, und in Sätzen, die kürzer sind als dieser hier.

Ein brauchbarer Text sieht ungefähr so aus:

```
So geht es weiter:

1. Überweise 81,49 € auf das Konto oben.
2. Als Verwendungszweck bitte NUR die Rechnungsnummer angeben.
3. Sobald das Geld da ist, bekommst du eine Mail und ich packe.

Ich versende dienstags und freitags. Bei Fragen einfach antworten.
```

Vier Zeilen. Kein "Vielen Dank für Ihr Vertrauen in unser Unternehmen". Der Käufer liest das auf dem Handy, während er schon halb in der Banking-App ist.

## Der Verwendungszweck ist dein einziger Schlüssel

Wenn drei Bestellungen offen sind, weißt du noch, wer wer ist. Bei zwölf nicht mehr, besonders wenn zwei davon Müller heißen und eine Person mit dem Konto ihres Partners überweist.

Der Verwendungszweck ist die einzige Verbindung zwischen der Zeile auf deinem Kontoauszug und der Bestellung in deinem Shop. Behandle ihn entsprechend.

Sailo vergibt für jede Bestellung automatisch eine Rechnungsnummer, fortlaufend pro Shop, mit einem Präfix, das du selbst setzt. Standard ist `INV`, aber du kannst `RE` daraus machen oder die Initialen deines Shops. Die Nummer ist vierstellig aufgefüllt, also `RE-0001`, `RE-0002`, und so weiter. Genau diese Nummer nimmst du als Verwendungszweck.

Und jetzt der Teil, den man erst nach ein paar Wochen lernt: Käufer tippen den Verwendungszweck falsch ab, sobald er länger ist als ihr eigener Nachname. Halte ihn kurz. `RE-0043` ist gut. `Bestellung Nr. 0043 vom 06.08.2026 Keramikmanufaktur` ist eine Zeile, die regelmäßig verstümmelt bei dir ankommt, und dann suchst du.

Drei Regeln, die das Problem fast auflösen:

1. Präfix maximal zwei bis drei Zeichen. Nicht dein voller Shopname.
2. Schreib "bitte nur die Nummer angeben" ausdrücklich dazu. Ohne den Hinweis schreiben Leute ihren eigenen Namen dazu, was harmlos ist, oder "Geschenk für Oma", was es nicht ist.
3. Nimm die Nummer, die auch auf der Rechnung steht. Zwei verschiedene Nummern für dieselbe Bestellung sind der zuverlässigste Weg, dich selbst zu verwirren.

Wie die Rechnungsnummer sonst noch mit deinen Pflichten zusammenhängt und was passiert, wenn eine Nummer auf einer stornierten Bestellung sitzt, steht in [Rechnung schreiben als Kleinunternehmer](/de/blog/rechnung-schreiben-als-kleinunternehmer).

## Wie lange du wartest

Setz dir eine Frist und schreib sie hin. Ohne Frist wird jede offene Bestellung zu einer offenen Frage in deinem Kopf.

Eine Regel, die für kleine Shops funktioniert:

- Tag 0: Bestellung kommt rein, Käufer bekommt IBAN und Verwendungszweck.
- Tag 3: Nichts da. Eine kurze, freundliche Erinnerung mit der Nummer im Betreff.
- Tag 7: Immer noch nichts. Zweite Nachricht, mit dem Hinweis, dass du die Bestellung am Tag 10 stornierst und die Ware wieder freigibst.
- Tag 10: Stornieren. Ohne schlechtes Gefühl.

Der Grund für Tag 10 und nicht Tag 30 ist nicht Härte. Es ist, dass du bei begrenztem Bestand nicht wochenlang ein Stück blockieren kannst, das jemand anderes gekauft hätte. Sailo gibt bei einer stornierten Bestellung die Stückzahl wieder frei, aber es macht das erst, wenn du stornierst.

Ein Detail zur Geschwindigkeit: Normale Überweisungen innerhalb Deutschlands sind in der Regel am nächsten Bankarbeitstag da. Viele Banken bieten inzwischen Echtzeitüberweisung an, bei der das Geld in Sekunden gutgeschrieben wird. Ob deine Bank das anbietet, ob es etwas kostet und welche Beträge gehen, steht in deinen Konditionen. Ich nenne hier bewusst keine gesetzliche Höchstfrist und keine Gebühr, weil beides sich ändert und der Vergleich vom Institut abhängt.

## Wenn der Betrag nicht stimmt

Passiert häufiger, als man denkt. Meistens sind es Cent-Beträge, weil jemand den Versand vergessen oder auf einen glatten Betrag gerundet hat.

Mach dir vorher eine Schwelle aus. Zum Beispiel: Unter zwei Euro Differenz versendest du und schreibst nichts. Zwischen zwei und zehn Euro schreibst du eine Zeile, versendest aber trotzdem, wenn du die Person kennst. Über zehn Euro wartest du auf den Rest.

Der Grund für die Schwelle ist Rechenzeit. Eine Nachricht schreiben, auf Antwort warten, die Nachzahlung suchen und zuordnen kostet dich zusammen leicht zehn Minuten. Bei 1,20 Euro Differenz ist das der schlechteste Stundenlohn deines Tages.

Wenn jemand zu viel überweist, ist die Sache einfacher, aber nicht egal: Zurücküberweisen, und zwar zeitnah, und die Rückzahlung dokumentieren.

## Was mit dem Rest deiner Zahlungswege ist

Überweisung ist bei Sailo einer von acht Wegen. Die vollständige Liste: Karte, WhatsApp, Telegram, Instagram, E-Mail, Telefon, Überweisung, Nachnahme. Mehr gibt es nicht.

Das heißt konkret: kein PayPal, kein Klarna, kein SEPA-Lastschriftverfahren, kein giropay als eigene Zahlart. Wenn deine Käufer PayPal erwarten, kannst du deine PayPal-Adresse zwar in den Hinweistext schreiben, aber Sailo weiß dann nichts davon, ordnet nichts zu und zeigt es dem Käufer nicht als eigenen Knopf. Das ist ein Behelf, keine Funktion, und ich nenne es hier als Behelf.

Kartenzahlung gibt es, weil Stripe in Deutschland verfügbar ist (Stand: 6. August 2026, geprüft auf stripe.com/global). Sie hängt an einem Stripe-Konto, das Stripe für Zahlungen freigegeben hat. Sailo nimmt dann {{fee_range}} Prozent vom Warenwert nach Rabatt, ohne Versand und ohne Steuer. Stripes eigene Gebühr kommt dazu und steht auf deren Preisseite.

Der Vergleich, der in der Praxis zählt, ist nicht Gebühr gegen Gebühr. Er ist Gebühr gegen deine Zeit.

| | Überweisung | Karte |
|---|---|---|
| Kosten an Sailo | 0 € | {{fee_range}} % vom Warenwert plus {{business_monthly}} $ Abo im Monat |
| Wann das Geld da ist | Meist nächster Bankarbeitstag | Sofort autorisiert, Auszahlung nach Stripes Rhythmus |
| Wer prüft den Eingang | Du, im Onlinebanking | Niemand, es passiert von selbst |
| Was schiefgeht | Falscher Verwendungszweck, zu wenig überwiesen | Ablehnung durch die Bank des Käufers, Rückbuchung |
| Aufwand pro Bestellung | Ein bis zwei Minuten | Null |

Bei acht Bestellungen im Monat gewinnt die Überweisung deutlich. Bei achtzig gewinnt die Karte, und zwar nicht wegen der Konversion, sondern weil dir sonst jeden Tag zwanzig Minuten Abgleich fehlen.

## Tobias in Bremen, durchgerechnet

Tobias röstet Kaffee in Bremen-Findorff, im Nebenerwerb, samstags. 250-Gramm-Packung für 14,90 Euro, 500 Gramm für 26,50 Euro. Ungefähr dreißig Bestellungen im Monat, die meisten über Instagram und Mundpropaganda aus dem Viertel.

Sein Setup: Überweisung und Abholung. Kein Karte, kein Abo. Sailo im kostenlosen Tarif, weil er sechs Produkte hat.

Eine durchschnittliche Bestellung sind zwei Packungen zu 250 Gramm plus Versand, also 29,80 Euro Ware plus 4,99 Euro Versand, macht 34,79 Euro. Rechnungsnummer `TOB-0112`, genau das steht im Verwendungszweck.

Sein Ablauf, jeden Abend um halb neun: Banking auf, offene Bestellungen in Sailo daneben, abhaken. Bei dreißig Bestellungen im Monat sind das im Schnitt eine pro Tag, also unter einer Minute Arbeit. Am Freitag druckt er die Etiketten, am Samstag früh bringt er alles zur Filiale.

Was er an Sailo zahlt: 0 Euro. Was ihn Kartenzahlung kosten würde: {{business_monthly}} Dollar im Monat plus {{fee_range}} Prozent auf rund 890 Euro Warenwert, also etwa 4,45 Euro Provision, plus Stripes Gebühr. Für ihn ergibt das keinen Sinn, solange niemand danach fragt. Und danach gefragt hat in acht Monaten genau eine Person.

## Was Überweisung nicht kann

Sailo kann dir nicht sagen, dass eine Überweisung angekommen ist. Nur deine Bank kann das. Es gibt keine Kontoanbindung, keinen automatischen Abgleich, keinen Import von Umsätzen. Der Statuswechsel auf "bezahlt" ist eine Handlung, die du machst, nachdem du selbst nachgesehen hast.

Das ist die ehrliche Grenze dieses Zahlungswegs, und sie ist nicht klein. Sie bedeutet: Bei Urlaub, Krankheit oder einer vollen Woche stapeln sich offene Bestellungen, und niemand außer dir kann sie auflösen. Wenn dein Verkauf an einem Tag dreißig Bestellungen bringt, weil ein Beitrag gut lief, hast du am Abend dreißig Zeilen abzugleichen.

Zweite Grenze: Überweisung ist eine schlechtere Zahlart für Impulskäufe. Wer um 23 Uhr auf dem Sofa etwas hübsch findet, macht die Banking-App mit ihren zwei Faktoren seltener auf als er eine gespeicherte Karte antippt. Für Handmade mit Wartezeit ist das kaum relevant. Für alles unter zehn Euro schon.

## Diese Woche

1. Trag deine Bankdaten ein, vollständig, inklusive Kontoinhaber genau wie bei der Bank.
2. Schreib den Hinweistext neu, maximal fünf Zeilen, mit "bitte nur die Nummer als Verwendungszweck".
3. Kürze dein Rechnungspräfix auf zwei oder drei Zeichen.
4. Leg deine Fristen fest: wann du erinnerst, wann du stornierst. Schreib sie irgendwohin, wo du sie siehst.
5. Mach dir einen festen Termin am Tag für den Abgleich. Nicht "wenn ich Zeit habe".

Wenn dein Problem gerade nicht der Abgleich ist, sondern dass zu wenig reinkommt, das dabei abzugleichen wäre, ist [Die ersten Bestellungen bekommen](/de/blog/die-ersten-bestellungen-bekommen) der nützlichere Text.

Wenn du gerade erst anfängst und noch nicht weißt, ob Überweisung für deine Käufer der richtige Weg ist, hilft der Überblick in [Online verkaufen ohne Website](/de/blog/online-verkaufen-ohne-website) bei der Entscheidung. Und bevor du die erste Zahlung entgegennimmst, klär den Fall, in dem jemand die Ware zurückschicken will: [Widerrufsrecht im kleinen Shop](/de/blog/widerrufsrecht-im-kleinen-shop) beschreibt, was dann mit dem Geld passiert, das du gerade erst bekommen hast.
