export const VENUES = {
  "brentford-fc": {
    name: "Brentford FC - Gtech Community Stadium",
    tag: "MATCHDAY PARTNER",
    subtitle:
      "Don't queue. Order drinks to your seat, nearest point, or collect at your pace.",
    branding: {
      eyebrow: "Brentford Matchday Service",
      heroTitle: "Stadium pours without the concourse queue",
      heroCopy:
        "Built for fast rounds, moving crowds, and keeping supporters in the moment from kickoff to full time.",
      staffCopy:
        "Venue-specific live operations for Brentford FC matchday service.",
      logo: "/assets/drinq-wordmark.webp?v=20260314b",
      mark: "BFC",
      accent: "#b31942",
      accentSoft: "#f2d5dd",
      glow: "rgba(179, 25, 66, 0.16)"
    },
    fulfillmentModes: [
      {
        label: "Seat Delivery",
        eta: "15-20 min",
        fee: "PS1.99",
        detail: "Runner delivers directly to your seat block/row/seat."
      },
      {
        label: "Nearest Point",
        eta: "8-12 min",
        fee: "PS0.99",
        detail: "Pickup at your closest accessible delivery point."
      },
      {
        label: "Click & Collect",
        eta: "5-10 min",
        fee: "Free",
        detail: "Collect at designated partner bar lane."
      }
    ],
    menuItems: [
      {
        id: "bf-lager",
        name: "House Lager Pint",
        category: "Beer",
        price: "PS6.80",
        options: ["Seat Delivery", "Nearest Point", "Click & Collect"]
      },
      {
        id: "bf-cider",
        name: "Dry Cider Pint",
        category: "Beer",
        price: "PS6.60",
        options: ["Seat Delivery", "Nearest Point", "Click & Collect"]
      },
      {
        id: "bf-gintonic",
        name: "Gin & Tonic",
        category: "Spirits",
        price: "PS8.20",
        options: ["Seat Delivery", "Nearest Point", "Click & Collect"]
      },
      {
        id: "bf-soft",
        name: "Soft Drink 500ml",
        category: "Soft Drinks",
        price: "PS3.00",
        options: ["Seat Delivery", "Nearest Point", "Click & Collect"]
      },
      {
        id: "bf-water",
        name: "Water 500ml",
        category: "Soft Drinks",
        price: "PS2.20",
        options: ["Seat Delivery", "Nearest Point", "Click & Collect"]
      }
    ]
  }
};
