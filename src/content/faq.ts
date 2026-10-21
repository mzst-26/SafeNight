/**
 * FAQ content for /faq. Single source of truth: app/faq.tsx renders these
 * strings as visible text, and T08 builds FAQPage JSON-LD from the same array.
 * Answers are plain text. The first sentence answers the question directly.
 * Facts are sourced in docs/seo/SEO_PLAN.md (T05 report).
 */

export const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: 'What is SafeNight?',
    answer:
      'SafeNight is a walking app that helps pedestrians find safer routes at night. It builds a walking network from OpenStreetMap data, scores street segments on five factors, and suggests alternative routes with turn-by-turn navigation. It runs on Android and in the web browser.',
  },
  {
    question: 'Is SafeNight free?',
    answer:
      'Yes, SafeNight has a free plan. Free users have limits on route searches, navigation sessions, emergency contacts, AI explanations and live location sharing, and routes are capped at 1 km. The paid Guarded and Family Pack plans raise these limits, and the Family Pack needs at least three members.',
  },
  {
    question: 'Which devices does SafeNight run on?',
    answer:
      'SafeNight runs on Android phones and in web browsers. The web app offers an Android download when you start navigation. An iPhone version is coming soon and is not available yet.',
  },
  {
    question: 'How does SafeNight decide a route is safer?',
    answer:
      'SafeNight scores each street segment on five factors: street lighting, crime density, road type, nearby activity (open places, CCTV and transit stops) and isolation. Darkness is worked out from the sun\'s position at the time you walk, not from a fixed night-time schedule. The segment scores are combined into a route score from 0 to 100, where a higher score means a safer route.',
  },
  {
    question: 'Does the time I leave change my route?',
    answer:
      'Yes. You can choose Leave now, Leave at or Arrive by. For Arrive by, SafeNight works back from your arrival time to estimate when you start. The same street can score differently at 6 pm and 11 pm, and each route shows whether it is daylit, reaches dusk, gets dark before you arrive, or is dark from the start.',
  },
  {
    question: "Where does SafeNight's data come from?",
    answer:
      'Crime data comes from the UK Police data portal, which covers England and Wales. Street lighting, road types, CCTV, open businesses and transit stops come from OpenStreetMap, read through the Overpass API. Walking directions use OSRM, place search uses Nominatim, and how busy an area is at a given time is estimated from nearby venues.',
  },
  {
    question: 'Why does a route say crime data is unavailable?',
    answer:
      'Crime data is requested live from the UK Police data portal. If the portal cannot be reached or returns an error, SafeNight shows a "Crime data unavailable" notice. It does not treat the missing crime data as a clean record, and it uses a neutral estimate instead.',
  },
  {
    question: 'Why is some street lighting marked as estimated?',
    answer:
      'Many streets have no lighting tags or lamp data in OpenStreetMap. SafeNight estimates lighting from the type of street and nearby roads. On the map, estimated stretches are drawn as dashed lines, so you can see which parts are known and which are estimated.',
  },
  {
    question: 'Does SafeNight work everywhere?',
    answer:
      'No. Crime data comes from the UK Police data portal, which covers England and Wales only, so crime scores are not available in areas it does not cover. Map data also depends on OpenStreetMap coverage, so less-mapped areas may have fewer details. Treat scores there with extra caution.',
  },
  {
    question: 'Does SafeNight share my location?',
    answer:
      'If you are signed in and have added Safety Circle contacts, starting navigation shares your live location with them, and Android asks for background location permission to do that. Otherwise SafeNight uses your precise location for navigation, route scoring and nearby places. Map lookups use OSRM, Overpass and Nominatim.',
  },
  {
    question: 'Is a safer route guaranteed to be safe?',
    answer:
      'No. A safer route has a better score than the alternatives, based on public data, but no route can be guaranteed safe. Scores are estimates and may not reflect what is happening on the street right now. In an emergency, call 999.',
  },
  {
    question: 'How do I delete my account?',
    answer:
      'In the app, log in, tap the profile icon on the map screen, scroll down, tap Delete Account and confirm. In-app deletion takes effect immediately and permanently. If you cannot use the app, email a deletion request and it will be completed within 30 days. See the delete account page for details.',
  },
];
