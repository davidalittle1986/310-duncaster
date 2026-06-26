const SITE = {
  title: "310 Duncaster",
  subtitle: "Construction Reference",

  floors: {
    downstairs: {
      label: "Downstairs",
      floorplan: "images/downstairs-floorplan.jpg",
      // viewBox is 1000x1000; x,y are the hotspot center positions
      // Adjust these values if hotspots need repositioning after viewing on screen
      rooms: [
        { id: "veranda",            label: "Veranda",             x: 209, y: 336 },
        { id: "garage",             label: "Garage",              x: 830, y: 275 },
        { id: "game",               label: "Game Room",           x: 588, y: 108 },
        { id: "powder",             label: "Powder Room",         x: 479, y: 250 },
        { id: "stairs-mud-hall",    label: "Stairs, Mud & Hall",  x: 621, y: 491 },
        { id: "pantry",             label: "Pantry",              x: 501, y: 422 },
        { id: "kitchen-great-room", label: "Kitchen & Great Room",x: 252, y: 586 },
        { id: "foyer",              label: "Foyer",               x: 289, y: 768 },
        { id: "dining-bar",         label: "Dining & Bar",        x: 525, y: 801 },
        { id: "bdrm",               label: "Guest Bedroom",       x: 118, y: 873 },
      ]
    },
    upstairs: {
      label: "Upstairs",
      floorplan: "images/upstairs-floorplan.jpg",
      rooms: [
        { id: "n-bdrm",          label: "Guest Bedroom",    x: 115, y: 321 },
        { id: "s-bdrm",          label: "Emily's Bedroom",  x: 326, y: 322 },
        { id: "e-bdrm",          label: "Sloane's Bedroom", x: 655, y: 198 },
        { id: "se-bdrm",         label: "Workout Room",     x: 883, y: 341 },
        { id: "utility",         label: "Laundry",          x: 359, y: 519 },
        { id: "storage-closet",  label: "Storage Closet",   x: 625, y: 484 },
        { id: "av-closet",       label: "AV Closet",        x: 746, y: 361 },
        { id: "game",            label: "David's Office",   x: 863, y: 554 },
        { id: "balcony",         label: "Balcony",          x: 588, y: 719 },
        { id: "master",          label: "Master Bedroom",   x: 469, y: 850 },
        { id: "master-bathroom", label: "Master Bathroom",  x: 159, y: 867 },
        { id: "master-closet",   label: "Master Closet",    x: 193, y: 639 },
        { id: "home-office",     label: "Lorin's Office",   x: 684, y: 828 },
      ]
    }
  }
};
