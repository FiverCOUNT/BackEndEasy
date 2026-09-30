const APPS = {
  easy: {
    slug: 'easy',
    marca: 'Easy',
    view: 'legal/privacidad-easy',
  },
};

function notFound(res) {
  res.status(404).render('legal/privacidad-no-encontrado', {
    title: 'Política de Privacidad',
  });
}

function index(req, res) {
  return showEasy(res);
}

function showEasy(res) {
  return res.render('legal/privacidad-easy', {
    title: 'Política de Privacidad · Easy',
    app: APPS.easy,
    actualizado: '2 de septiembre de 2026',
  });
}

function show(req, res) {
  const slug = String(req.params.app || '').trim().toLowerCase();
  const app = APPS[slug];
  if (!app) {
    return notFound(res);
  }

  return showEasy(res);
}

module.exports = {
  index,
  show,
  APPS,
};
