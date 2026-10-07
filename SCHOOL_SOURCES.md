# School menu source assessment — October 6, 2026

All eight supplied school sites have a readable public menu source. Seven new choices have been added; Loomis was already supported. Including SPS, the app now supports nine schools. No private school credentials are required.

| School | Public source | Selected main station and interpretation | Limitations |
|---|---|---|---|
| Phillips Academy Andover | MyDiningHub public Elevate GraphQL API | **2nd Floor Home Zone** (station 230457). Use the exact date/meal SKU map and recipe marketing names; ignore ingredient toppings, soups and plant-based substitutes. Classify meat dishes as Entrée, starches/vegetables as Sides. | Menu station and dish-name rules are based on October 5–7 lunch/dinner. Home Zone & Grill, other grill/pizza/salad and accommodation stations are excluded. |
| Groton | Flik public weekly JSON | `menu_info` labels distinguish Entree, Vegetarian Entree, Soup and Dessert even when visible header rows are absent. Main text before the first comma becomes Entrée; subsequent side fragments become Sides, excluding toppings. | Entrée and sides are often a bundled sentence. Split labels are an inference; a future unusual comma in a main name may require a rule update. |
| Lawrenceville | Google Sites page with dated headings and meal paragraphs | Match the weekday, month/day and meal exactly. Recent menus list Soup, two main choices, two sides, then permanent bars/fruit/dessert. Use that sequence, excluding alternatives and bars. | The page omits the year. The requested current-year weekday must match. Only dates actually on the page are available; no neighboring-date fallback. Category labels are inferred. |
| Deerfield | Public dining-hall HTML | Use `data-group` metadata for Entrée/Starch/Side/Bread/Dessert. The site emits single-item categories without metadata; classify those by dish name. Drop Cold Bars, Special Bar, Pasta/Pizza stations, toppings and allergen text. | Only displayed dates are available. Singleton category labels use dish-name inference. |
| Cate | Flik public weekly JSON | Only Hot Lunch/Dinner Offerings (or unnamed Menu group on days lacking a header). Identify meat dishes by name rather than position; exclude tortillas, sauces, toppings and substitute dishes. | School timezone is **America/Los_Angeles**; dates and notification times follow Pacific time. |
| Taft | MyDiningHub public Elevate GraphQL API | **Home Zone** (station 226174). Exact meal/date map, marketing names and ingredient markers; exclude soups, substitutions and ingredient toppings. | Main dishes are not always the first item, so order alone is insufficient. Classification is inferred from October 5–7 menus and dish names. |
| Loomis | Flik public weekly JSON | Existing **Grill Main** rule preserved: first item Entrée, remaining items Sides; only the first item receives rating buttons. | Positional rule explicitly selected by the app owner. |
| Peddie | Public WordPress Events Calendar JSON API, category `pfs-menus` | Select exact event date and Lunch/Dinner title. Parse the full event description, not truncated list excerpts. Main offerings precede the permanent Pasta/Marinara/Rice line; classify mains and sides there, and retain dessert/bread later. | Explicit Closed/Cancelled titles produce a closure notice. Only published events are available; source structure/category labels are partly inferred. |

## Verified examples

- Andover 10/6 lunch: Beef Taco / Southwest Chicken Taco; Southwest Corn, Refried Beans, Spanish Rice.
- Groton 10/6 dinner: BBQ Beef Brisket; Mac n Cheese, Corn on the Cobb, Braised Collards, Spicy Pickles.
- Lawrenceville 10/6 dinner: Carolina Baby Back Ribs / Blackened Roasted Catfish; Corn Bread, Collard Greens.
- Deerfield 10/6 lunch: Caprese Chicken Breast; Potato Chips; Rice Krispie Squares.
- Cate 10/6 lunch: Pork Taco Meat. Corn Tortilla and Vegetable Taco Filling are not treated as the main.
- Taft 10/6 dinner: Beef Tri-Tip Chimichurri; Cumin Roasted Cauliflower, Cilantro Lime Rice.
- Peddie 10/6 lunch: explicitly Closed Long Weekend. Dinner has Chicken with Hearty Vegetable Gravy and Fried Flounder.

All nine schools' lunch and dinner sources were fetched using the final implementation on October 6. All requests completed successfully; Peddie's lunch correctly returned a closure. 28 tests cover classification, exact dates, missing dates, closures, provider errors, school isolation and existing app behavior. Captured menu fixtures are in `test/providers/`; full public-page research snapshots are in the workspace `work/school-research/`.

## App behavior retained

- Setup, reminders, /food, /votes, English copy, footer, three-state voting and historical school-wide totals use the existing flow.
- Multiple genuine entrées receive one button group each (up to five); Loomis remains one entrée/one group.
- Dates outside a source's published range show no published menu, never a different day's menu.
- Cate uses Pacific school time; the other schools use America/New_York. Sunday lunch reminders remain disabled; dinner reminders run daily. Breakfast and brunch remain unsupported.
- Future dishes with unfamiliar names may require classification updates. Explicit source metadata is preferred over inferred names; categories are not generated by an unbounded runtime AI guess.

## Original pages

- https://phillipsacademy.mydininghub.com/en/location/paresky-dining
- https://grotonschool.flikisdining.com/menu/groton-school/
- https://sites.google.com/lawrenceville.org/dining-menu/home
- https://deerfield.edu/students/dining-hall-and-stores/menu
- https://cate.flikisdining.com/menu/cate-school-high-school
- https://taft.mydininghub.com/en/location/horace-dutton-taft
- https://loomischaffee.flikisdining.com/
- https://peddie.org/events/category/pfs-menus/list


## Western Reserve Academy and weekend reminder review — October 6, 2026

The public deck https://docs.google.com/presentation/d/1xHWF4RymuEc51msed9bs7XyhH-6N4OHg4dAH8cOofuA/edit exports as PPTX without school credentials. Only slide1–3 XML is retained: Breakfast, Lunch & Brunch, Dinner. The Week of 10/5 tables label Saturday and Sunday as Brunch. WRA selects BRAVO, Pioneer Plates and Inspired Eats, excludes V2 and everyday staples, classifies dish names, and caches dated week data. Weekly prefetch starts Monday 06:00 Eastern and retries before 07:00; source publication and outages can prevent completion. Queries fetch on demand if the cache lacks the requested week. Out-of-week results are not substituted.

Weekend evidence:
- Loomis: official Open Hours page explicitly says Saturday/Sunday brunch. Both weekend lunch reminders disabled. https://www.loomischaffee.org/news/daily-bulletin/open-hours
- WRA: current deck explicitly labels both weekend days brunch; weekday lunch reminders only.
- Deerfield: official bulletin lists Saturday Lunch and Sunday Brunch. Saturday retained. https://deerfield.edu/students/
- Taft: official Taft Eats page says breakfast/lunch Monday–Saturday, brunch Sunday. https://www.taftschool.org/campus-life/daily-life/taft-eats
- Lawrenceville: official dining page lists Saturday lunch and Sunday brunch. https://sites.google.com/lawrenceville.org/dining-menu/home
- Groton: October10 brunch JSON explicitly says “Breakfast and lunch offered in lieu of brunch.” Saturday lunch retained; merely having a brunch response is not evidence of brunch service.
- Peddie: October10 events explicitly include Breakfast, Lunch and Dinner. Saturday lunch retained; a Brunch event replacing an absent Lunch suppresses notifications on that date. A permanent weekend pattern remains unverified.
- SPS: preserve owner-selected Sunday skip and Saturday lunch.
- Cate and Andover: permanent weekend brunch patterns not confirmed from a current official regular-term timetable. Preserve Saturday lunch and existing Sunday skip; when an absent Saturday lunch has actual brunch menu items, suppress that day's lunch notification. Do not infer brunch from an empty or failed endpoint.

All ten schools remain available in setup. Skipping brunch is a notification rule; breakfast/brunch slash-command replies remain unchanged.
