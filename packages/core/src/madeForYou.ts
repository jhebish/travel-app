/**
 * "Same city, different trips": the home page's example of how Pylos plans for the person, not
 * for everyone. Three made-up travelers, the same Saturday in Lisbon, and why each stop was
 * picked for them, read from the trips they'd already taken. Shared by the site and the app.
 */

export interface DemoStop {
  /** "09:30", or "Stay" for the hotel. */
  time: string;
  name: string;
  /** Why it's for them, from their earlier trips. */
  why: string;
}

export interface DemoTraveler {
  key: string;
  name: string;
  /** Who they are, in a few words: "Plans her trips around lunch". */
  tag: string;
  /** The label on each reason: "For her". */
  forLabel: string;
  /** What Pylos learned from their trips. */
  learned: string;
  stops: DemoStop[];
}

export const DEMO_CITY = "Lisbon";

export const DEMO_TRAVELERS: DemoTraveler[] = [
  {
    key: "food",
    name: "Inès",
    tag: "Plans her trips around lunch",
    forLabel: "For her",
    learned: "Counter seats, market mornings, small design hotels and natural wine, from 7 past trips.",
    stops: [
      { time: "Stay", name: "A six-room guesthouse in Príncipe Real", why: "Like the small design hotels she rated highest, in Mexico City and Kyoto." },
      { time: "09:30", name: "Mercado de Campo de Ourique", why: "She starts every trip at a market." },
      { time: "13:00", name: "A no-reservations tasca in Alfama", why: "Counter seats and a chalkboard menu, like her favorite lunch in San Sebastián." },
      { time: "18:00", name: "Ginjinha in Rossio, then the Graça viewpoint", why: "She saved sunset spots in Porto and Istanbul." },
      { time: "21:00", name: "Cervejaria Ramiro", why: "Shellfish by the kilo: her five-star night was in Galicia." },
    ],
  },
  {
    key: "family",
    name: "The Lees",
    tag: "Two kids, dinner by six",
    forLabel: "For them",
    learned: "A kitchen and a pool, short hops between stops, and boats, from 5 family trips.",
    stops: [
      { time: "Stay", name: "An apartment hotel by the river, with a pool", why: "They book a kitchen and a pool whenever the kids come." },
      { time: "09:30", name: "Oceanário de Lisboa", why: "The aquarium was the top-rated stop of their Valencia trip." },
      { time: "12:30", name: "Pastéis de Belém, then the Jerónimos cloisters", why: "Custard tarts first: a snack keeps the walking short." },
      { time: "15:30", name: "The ferry to Cacilhas and back", why: "The boat rides were the highlight of Istanbul." },
      { time: "18:00", name: "Time Out Market", why: "Everyone picks their own, and they eat early." },
    ],
  },
  {
    key: "night",
    name: "Theo",
    tag: "Out until sunrise",
    forLabel: "For him",
    learned: "Late starts, warehouse markets, bar-hopping streets and a club every trip, from 9 past trips.",
    stops: [
      { time: "Stay", name: "A design hotel in Cais do Sodré", why: "He stays where the night starts, not where it's quiet." },
      { time: "12:30", name: "A late brunch in Santos", why: "He's never booked anything before noon." },
      { time: "16:00", name: "LX Factory", why: "He loved Berlin's warehouse markets and bookshops." },
      { time: "22:00", name: "Bairro Alto, bar to bar", why: "Small bars spilling into the street, like Tbilisi's old town." },
      { time: "02:00", name: "Lux Frágil", why: "He went dancing on four of his last five trips." },
    ],
  },
];

/** The three ways Pylos gets to know someone, without the plumbing. */
export const HOW_PYLOS_LEARNS: { title: string; text: string }[] = [
  { title: "Where you've been", text: "Bring in your past trips from the accounts you already use, or tap them in." },
  { title: "What you loved", text: "A few quick questions, and a tap for each place you'd go back to." },
  { title: "Where you'll love next", text: "Hotels, tables and a pace picked for you, from the places locals go." },
];
