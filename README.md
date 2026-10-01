# EkoAgroTech OLX

Panel do edycji własnych ogłoszeń przez oficjalne OLX Partner API v2.

## Funkcje

- Lista ogłoszeń z paginacją po 100 pozycji, wyszukiwaniem i filtrem statusu na bieżącej stronie.
- Edycja tytułu, opisu, ceny, negocjacji, nazwy kontaktu, telefonu i zdjęć przez publiczne adresy URL.
- Zapis przez `PUT /api/partner/adverts/{id}` z zachowaniem kategorii, lokalizacji, parametrów, dostawy i danych bezpieczeństwa produktu.
- Logowanie `admin` z hasłem z konfiguracji, podpisane formularze, wykrywanie zmian od otwarcia formularza, ochrona HTML i komunikaty błędów OLX.
- Tokeny OAuth zapisane w PostgreSQL, automatyczne odświeżanie i jednokrotne wykorzystanie OAuth state.

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

`npm test` sprawdza działające trasy HTTP z symulowanymi odpowiedziami OLX: formularz, pełny PUT, zachowanie pól, walidację, błędy, paginację, odświeżanie tokenu, zabezpieczenie formularza i konflikt wersji. Testy nie zmieniają prawdziwych ogłoszeń i nie potrzebują sekretów ani bazy. Zapis do produkcyjnego konta należy potwierdzić na wybranym ogłoszeniu po wdrożeniu.

OLX sam sprawdza reguły konkretnej kategorii. Nowe zdjęcia muszą być dostępne przez publiczne URL; panel nie hostuje plików. Ochrona wersji sprawdza stan tuż przed PUT, ale OLX nie udostępnia tu atomowego warunkowego zapisu, więc zmiana wykonana równocześnie w innej aplikacji podczas samego PUT nadal może się ścigać z zapisem. Wdrożenie obsługuje jeden proces Node, jak istniejąca usługa Render.

Dokumentacja API: https://developer.olx.pl/api/doc
