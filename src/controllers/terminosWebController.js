const APPS = {
  easy: {
    slug: 'easy',
    marca: 'Easy',
    view: 'legal/terminos-easy',
  },
  cardumen: {
    slug: 'cardumen',
    marca: 'Cardumen',
    view: 'legal/terminos-cardumen',
  },
};

function notFound(res) {
  res.status(404).render('legal/terminos-no-encontrado', {
    title: 'Términos y condiciones',
  });
}

function index(req, res) {
  notFound(res);
}

function show(req, res) {
  const slug = String(req.params.app || '').trim().toLowerCase();
  const app = APPS[slug];
  if (!app) {
    return notFound(res);
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
