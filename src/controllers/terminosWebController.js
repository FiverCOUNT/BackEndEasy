const APPS = {
  easy: {
    slug: 'easy',
    marca: 'Easy',
    view: 'legal/terminos-easy',
    blurb: 'Facturación electrónica, catálogo e inventario.',
  },
  cardumen: {
    slug: 'cardumen',
    marca: 'Cardumen',
    view: 'legal/terminos-cardumen',
    blurb: 'Ubicaciones compartidas con consentimiento y vigencia temporal.',
  },
};

function index(req, res) {
  res.render('legal/terminos-index', {
    title: 'Términos y condiciones',
    apps: Object.values(APPS),
  });
}

function show(req, res) {
  const slug = String(req.params.app || '').trim().toLowerCase();
  const app = APPS[slug];
  if (!app) {
    return res.status(404).render('legal/terminos-index', {
      title: 'Términos y condiciones',
      apps: Object.values(APPS),
      error: 'No encontramos esa versión. Elige Easy o Cardumen.',
    });
  }

  return res.render(app.view, {
    title: `Términos y condiciones · ${app.marca}`,
    app,
    actualizado: '21 de julio de 2026',
  });
}

module.exports = {
  index,
  show,
  APPS,
};
