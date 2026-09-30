const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("EkoAgroTech OLX API działa.");
});

app.get("/olx/callback", (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send("OLX zwrócił błąd autoryzacji.");
  }

  if (!code) {
    return res.status(400).send("Brak kodu autoryzacyjnego OLX.");
  }

  res.send("Połączenie z OLX powiodło się. Możesz zamknąć tę stronę.");
});
