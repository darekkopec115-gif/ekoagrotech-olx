# EkoAgroTech OLX

Panel do edycji własnych ogłoszeń przez oficjalne OLX Partner API v2.

## Funkcje

- Lista ogłoszeń z paginacją po 100 pozycji, wyszukiwaniem i filtrem statusu na bieżącej stronie.
- Edycja tytułu, opisu, ceny, negocjacji, nazwy kontaktu, telefonu i zdjęć przez publiczne adresy URL.
- Tworzenie nowych ogłoszeń sprzedaży jako firma: wybór kategorii z drzewa OLX, jej aktualne parametry, cena, kontakt, miejscowość i dzielnica, zdjęcia oraz dane bezpieczeństwa produktu.
- „Utwórz podobne” kopiuje dane istniejącej oferty do nowego formularza; oryginalne ogłoszenie pozostaje bez zmian.
- Zapis przez `PUT /api/partner/adverts/{id}` z zachowaniem kategorii, lokalizacji, parametrów, dostawy i danych bezpieczeństwa produktu.
- Logowanie `admin` z hasłem z konfiguracji, podpisane formularze, wykrywanie zmian od otwarcia formularza, ochrona HTML i komunikaty błędów OLX.
- Tokeny OAuth zapisane w PostgreSQL, automatyczne odświeżanie i jednokrotne wykorzystanie OAuth state.
- Próby publikacji zapisane w osobnej tabeli PostgreSQL: ponowne wysłanie tego samego formularza zwraca utworzoną ofertę. Po utracie odpowiedzi panel sprawdza wynik przez `external_id` i nie ponawia niepotwierdzonego POST.

## Uruchomienie

Node.js 22 lub nowszy i PostgreSQL. Zmienne środowiskowe (bez umieszczania sekretów w repozytorium):

| Zmienna | Znaczenie |
| --- | --- |
| `OLX_CLIENT_ID` | ID zatwierdzonej aplikacji OLX |
| `OLX_CLIENT_SECRET` | Sekret aplikacji OLX |
| `DATABASE_URL` | Adres PostgreSQL, przechowującego istniejące tokeny |
| `ADMIN_PASSWORD` | Hasło panelu dla loginu `admin` |
| `OLX_REDIRECT_URI` | Opcjonalny callback; domyślnie `https://ekoagrotech-olx.onrender.com/olx/callback` |
| `PORT` | Port serwera, domyślnie 3000; Render ustawia automatycznie |
| `PGSSLMODE` | Ustaw `disable` tylko dla lokalnej bazy bez TLS |

```sh
npm ci
npm test
npm start
```

Na Render istniejąca usługa powinna używać polecenia budowania `npm ci` (dotychczasowe `npm install` także działa) i uruchamiania `npm start`. Zachowaj obecne zmienne i bazę. Po wdrożeniu otwórz `/`, zaloguj się i wybierz ogłoszenie. Konto łącz ponownie tylko w razie wygaśnięcia autoryzacji. Aplikacja OLX musi mieć zakresy `read write v2` oraz dokładnie zgodny callback. `/health` służy do sprawdzania działania serwera.

## Weryfikacja

`npm test` sprawdza działające trasy HTTP z symulowanymi odpowiedziami OLX: formularze, pełny PUT oraz POST, zachowanie pól edycji, parametry kategorii i wybór dzielnicy, walidację, błędy, paginację, odświeżanie tokenu, zabezpieczenie formularzy, konflikt wersji, równoczesne publikacje oraz odzyskanie wyniku po przerwanym połączeniu i restarcie. Testy nie zmieniają prawdziwych ogłoszeń i nie potrzebują sekretów ani bazy. Zapis i publikację do produkcyjnego konta należy potwierdzić na wybranym ogłoszeniu po wdrożeniu.

## Tworzenie nowej oferty

Na liście wybierz **+ Nowe ogłoszenie**, przejdź do końcowej kategorii i uzupełnij formularz. Alternatywnie wybierz **Utwórz podobne** przy istniejącej ofercie, sprawdź przeniesione dane i dostosuj je do nowej maszyny. Do nowej publikacji nie są kopiowane identyfikatory starej oferty, jej status, terminy, pakiety ani automatyczne przedłużanie.

Miejscowość wybierasz po nazwie; panel korzysta z oficjalnego, stronicowanego katalogu OLX i przechowuje go w pamięci przez sześć godzin. Pierwsze wyszukiwanie może potrwać dłużej. Jeśli katalog jest częściowo wczytany, przycisk **Szukaj dalej** rozszerza wyniki. Przy miastach podzielonych na dzielnice wybór dzielnicy jest wymagany. Wszystkie parametry i lokalizacja są ponownie sprawdzane na serwerze przed publikacją.

Nowe ogłoszenie wysyłane jest przez `POST /api/partner/adverts`. Po potwierdzonym utworzeniu otwiera się działający panel edycji nowej oferty. Komunikat odróżnia utworzenie od publicznej aktywacji: OLX może wymagać moderacji albo pakietu. Panel nie kupuje pakietów i nie włącza automatycznego przedłużania. Formularz sprzedaży nie obsługuje ogłoszeń zatrudnienia z wynagrodzeniem.

Serwer sam dodaje tabelę `olx_create_requests` podczas startu. Zachowaj obecną bazę i zmienne środowiskowe; migracja niczego nie usuwa. Niepewna próba publikacji pozostaje oznaczona w bazie również po restarcie. Użyj **Sprawdź wynik poprzedniej publikacji**, aby znaleźć utworzoną ofertę. Jeżeli OLX jeszcze jej nie zwraca, panel zachowuje formularz i blokuje ponowną publikację z tej samej próby. Chroni to przed duplikatami; nie jest to gwarancja atomowej idempotencji po stronie OLX.

OLX sam sprawdza reguły konkretnej kategorii. Nowe zdjęcia muszą być dostępne przez publiczne URL; panel nie hostuje plików. Ochrona wersji sprawdza stan tuż przed PUT, ale OLX nie udostępnia tu atomowego warunkowego zapisu, więc zmiana wykonana równocześnie w innej aplikacji podczas samego PUT nadal może się ścigać z zapisem. Wdrożenie obsługuje jeden proces Node, jak istniejąca usługa Render.

Dokumentacja API: https://developer.olx.pl/api/doc
