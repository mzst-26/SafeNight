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
      'SafeNight is a walking app that helps pedestrians find safer routes at night. It builds a walking network from OpenStreetMap data, scores street segments on six factors, and suggests alternative routes with turn-by-turn navigation. It runs on Android and in the web browser.',
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
      'SafeNight scores each street segment on six factors: crime, street lighting, CCTV, road type, open businesses and foot traffic. The weights change between late night (0 to 5 am), evening (6 pm to midnight) and daytime. Each route is split into short segments, and their risk is combined into a route score, where a higher score means a safer route.',
  },
  {
    question: "Where does SafeNight's data come from?",
    answer:
      'Crime data comes from the UK Police data portal, which covers England and Wales. Street lighting, road types, CCTV, open businesses and transit stops come from OpenStreetMap, read through the Overpass API. Walking directions use OSRM, place search uses Nominatim, and foot traffic is an estimate.',
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
