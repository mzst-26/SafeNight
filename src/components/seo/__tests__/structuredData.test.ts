import { PAGE_SEO, SEO } from '@/src/config/seo';
import { FAQ_ITEMS } from '@/src/content/faq';
import { faqGraph, homeGraph, jsonLdHtml, pageGraph } from '@/src/components/seo/StructuredData';

type Node = Record<string, any>;

function nodesOfType(graph: { '@graph': Node[] }, type: string): Node[] {
  return graph['@graph'].filter((node) => node['@type'] === type);
}

describe('jsonLdHtml', () => {
  it('escapes "<" so a value cannot close the script tag', () => {
    const data = { name: 'x</script><script>alert(1)</script>' };
    const out = jsonLdHtml(data);

    expect(out).not.toContain('<');
    expect(out).not.toContain('</script>');
  });

  it('round-trips through JSON.parse to the original data', () => {
    const data = { name: 'x</script><b>&', list: ['<a>', 'plain'] };

    expect(JSON.parse(jsonLdHtml(data))).toEqual(data);
  });
});

describe('faqGraph', () => {
  it('has Question and Answer text equal to FAQ_ITEMS exactly', () => {
    const graph = faqGraph() as Node;
    const entities = graph.mainEntity as Node[];

    expect(entities).toHaveLength(FAQ_ITEMS.length);
    entities.forEach((entity, index) => {
      expect(entity['@type']).toBe('Question');
      expect(entity.name).toBe(FAQ_ITEMS[index].question);
      expect(entity.acceptedAnswer['@type']).toBe('Answer');
      expect(entity.acceptedAnswer.text).toBe(FAQ_ITEMS[index].answer);
    });
  });
});

describe('homeGraph', () => {
  const graph = homeGraph() as { '@graph': Node[] };

  it('has exactly one Organization, WebSite, WebPage and application node', () => {
    expect(nodesOfType(graph, 'Organization')).toHaveLength(1);
    expect(nodesOfType(graph, 'WebSite')).toHaveLength(1);
    expect(nodesOfType(graph, 'WebPage')).toHaveLength(1);
    expect(nodesOfType(graph, 'MobileApplication')).toHaveLength(1);
  });

  it('contains no aggregateRating, review or potentialAction keys', () => {
    const serialised = JSON.stringify(graph);

    expect(serialised).not.toContain('"aggregateRating"');
    expect(serialised).not.toContain('"review"');
    expect(serialised).not.toContain('"potentialAction"');
  });

  it('gives every offer the GBP price currency', () => {
    const app = nodesOfType(graph, 'MobileApplication')[0];
    const offers = app.offers as Node[];

    expect(offers.length).toBeGreaterThan(0);
    offers.forEach((offer) => {
      expect(offer.priceCurrency).toBe('GBP');
      if (offer.priceSpecification) {
        expect(offer.priceSpecification.priceCurrency).toBe('GBP');
      }
    });
  });

  it('states the minimum group size for the Family Pack offer', () => {
    const app = nodesOfType(graph, 'MobileApplication')[0];
    const family = (app.offers as Node[]).find((offer) => offer.name === 'Family Pack');

    expect(family?.description).toContain('minimum of 3 members including the owner');
    expect(family?.priceSpecification.referenceQuantity).toEqual({
      '@type': 'QuantitativeValue',
      value: 1,
      unitCode: 'MON',
    });
  });
});

describe('pageGraph', () => {
  const graph = pageGraph('/privacy', 'Privacy Policy', ['Home', 'Privacy Policy']) as { '@graph': Node[] };

  it('gives the WebPage isPartOf an @id and the BreadcrumbList two items', () => {
    const webPage = nodesOfType(graph, 'WebPage')[0];
    const breadcrumb = nodesOfType(graph, 'BreadcrumbList')[0];

    expect(webPage.isPartOf['@id']).toBe(`${SEO.siteUrl}/#website`);
    expect(webPage.url).toBe(`${SEO.siteUrl}/privacy`);
    expect(webPage.description).toBe(PAGE_SEO['/privacy'].description);
    expect(breadcrumb.itemListElement).toHaveLength(2);
  });
});
