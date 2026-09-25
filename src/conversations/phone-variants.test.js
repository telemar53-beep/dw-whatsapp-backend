const { brazilianNumberVariants } = require('./phone-variants');

describe('brazilianNumberVariants', () => {
  test('celular com o 9: devolve a forma digitada e a forma sem o 9', () => {
    expect(brazilianNumberVariants('5598985120338')).toEqual(['5598985120338', '559885120338']);
  });

  test('celular sem o 9 (forma antiga do wa_id): devolve a forma digitada e a forma com o 9', () => {
    expect(brazilianNumberVariants('559885120338')).toEqual(['559885120338', '5598985120338']);
  });

  test.each(['551133334444', '559832345678', '559845678901', '559853456789'])(
    'fixo (8 dígitos começando com 2 a 5) nunca ganha variante de celular: %s',
    (fixo) => {
      expect(brazilianNumberVariants(fixo)).toEqual([fixo]);
    }
  );

  test('número estrangeiro fica como está', () => {
    expect(brazilianNumberVariants('14155552671')).toEqual(['14155552671']);
  });

  test('entrada vazia ou sem dígitos suficientes não inventa variante', () => {
    expect(brazilianNumberVariants('')).toEqual(['']);
    expect(brazilianNumberVariants('5598')).toEqual(['5598']);
  });
});
