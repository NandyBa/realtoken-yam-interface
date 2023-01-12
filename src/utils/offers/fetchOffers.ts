import {
  ApolloClient,
  InMemoryCache,
  NormalizedCacheObject,
  gql,
} from '@apollo/client';
import BigNumber from 'bignumber.js';
import { CHAINS, ChainsID } from 'src/constants';
import { DataRealtokenType } from 'src/types/offer/DataRealTokenType';
import { Offer } from 'src/types/Offer';
import { Offer as OfferGraphQl } from '../../../.graphclient/index';
import { parseOffer } from './parseOffer';
import { getTheGraphUrlYAM, getTheGraphUrlRealtoken } from './getClientURL';

export const getBigDataGraphRealtoken = async (
  chainId: number,
  client: ApolloClient<NormalizedCacheObject>,
  realtokenAccount: string[]
) => {
  const { address: realTokenYamUpgradeable } =
    CHAINS[chainId as ChainsID].contracts.realTokenYamUpgradeable;

  console.log('getBigDataGraphRealtoken', realtokenAccount.length);

  const accountRealtoken: string =
    '"' + realtokenAccount.map((account: string) => account).join('","') + '"';
  //console.log('DEBUG accountRealtoken', accountRealtoken);

  const { data } = await client.query({
    query: gql`
      query getAccountsRealtoken {
        accountBalances(
          first: 1000 
          where: {amount_gt: "0",id_in: [${accountRealtoken}]}
        ) {
          id
          amount
          allowances(
            where: {spender: "${realTokenYamUpgradeable}"}
          ) {
            allowance
            id
          }
        }
      }
    `,
  });
  //console.log('DEBUG getBigDataGraphRealtoken data', data);

  return data.accountBalances.map((accountBalance: DataRealtokenType) => {
    const allowance: { id: string; allowance: string } | undefined =
      accountBalance.allowances?.find(
        (allowance: { id: string; allowance: string }) =>
          accountBalance.id + '-' + realTokenYamUpgradeable === allowance.id
      );
    /*  console.log(
      'DEBUG data.accountBalances.map allowance',
      allowance,
      data.allowances,
      accountBalance.id + '-' + realTokenYamUpgradeable
    ); */

    return {
      id: accountBalance.id,
      amount: accountBalance.amount,
      allowance: allowance?.allowance ?? '0',
    };
  });
};

export const fetchOfferTheGraph = (
  chainId: number
  //propertiesToken: PropertiesToken[]
): Promise<Offer[]> => {
  return new Promise<Offer[]>(async (resolve, reject) => {
    try {
      const offersData: Offer[] = [];
      // const { data } = await execute(getOffersDocument, {}, {
      //   source: source
      // });
      const clientYAM = new ApolloClient({
        uri: getTheGraphUrlYAM(chainId),
        cache: new InMemoryCache(),
      });

      const clientRealtoken = new ApolloClient({
        uri: getTheGraphUrlRealtoken(chainId),
        cache: new InMemoryCache(),
      });

      //Récupère la liste des users qui ont créer une offre et les token associer a ses offres
      const { data: usersDataYAM } = await clientYAM.query({
        query: gql`
          query getUersData {
            accounts(
              first: 1000
              where: { offers_: { removedAtBlock: null } }
            ) {
              address
              offers {
                id
                offerToken {
                  address
                }
              }
            }
          }
        `,
      });

      //console.log('Debug Query usersDataYAM', usersDataYAM);

      let dataYAM; //TODO: tmp supprimer la partie false quant déploiement ok sur Eth et Gonosis, remettre en const a la place de let try = new graph, catch = old graph
      try {
        console.log('TRY dataYAM');

        ({ data: dataYAM } = await clientYAM.query({
          query: gql`
            query getOffers {
              offers(first: 1000, where: { removedAtBlock: null }) {
                id
                seller {
                  id
                  address
                }
                removedAtBlock
                availableAmount
                allowance {
                  allowance
                }
                balance {
                  amount
                }
                offerToken {
                  address
                  name
                  decimals
                  symbol
                  tokenType
                }
                price {
                  price
                  amount
                }
                buyerToken {
                  name
                  symbol
                  address
                  decimals
                  tokenType
                }
                buyer {
                  address
                }
              }
            }
          `,
        }));
      } catch (error) {
        console.log('CATCH dataYAM');

        ({ data: dataYAM } = await clientYAM.query({
          query: gql`
            query getOffers {
              offers(first: 1000, where: { removedAtBlock: null }) {
                id
                seller {
                  id
                  address
                }
                removedAtBlock
                availableAmount
                offerToken {
                  address
                  name
                  decimals
                  symbol
                  tokenType
                }
                price {
                  price
                  amount
                }
                buyerToken {
                  name
                  symbol
                  address
                  decimals
                  tokenType
                }
                buyer {
                  address
                }
              }
            }
          `,
        }));
      }

      console.log('Query dataYAM', dataYAM.offers.length);

      const accountRealtoken: string[] = usersDataYAM.accounts.map(
        (account: { address: string; offers: [] }) =>
          account.offers.map(
            (offer: { id: string; offerToken: { address: string } }) =>
              account.address + '-' + offer.offerToken.address
          )
      );
      const accountBalanceId: string[] = accountRealtoken.flat();
      //console.log('Debug liste accountBalanceId', accountBalanceId);

      const batchSize = 1000;
      const dataRealtoken: [DataRealtokenType] = [
        {
          amount: '0',
          id: '0',
        },
      ];
      for (let i = 0; i < accountBalanceId.length; i += batchSize) {
        const batch: string[] = accountBalanceId.slice(i, i + batchSize);
        /* dataRealtoken.push(
          await getBigDataGraphRealtoken(chainId, clientRealtoken, batch)
        ); */
        if (batch.length <= 0) break;

        const realtokenData: [DataRealtokenType] =
          await getBigDataGraphRealtoken(chainId, clientRealtoken, batch);

        //console.log('DEBUG for realtokenData', i, batchSize, realtokenData);
        dataRealtoken.push(...realtokenData);
      }

      //console.log('Debug Query dataRealtoken', dataRealtoken);

      await Promise.all(
        dataYAM.offers.map(async (offer: OfferGraphQl) => {
          const accountUserRealtoken: DataRealtokenType = dataRealtoken.find(
            (accountBalance: DataRealtokenType): boolean =>
              accountBalance.id ===
              offer.seller.address + '-' + offer.offerToken.address
          )!;

          const offerData: Offer = await parseOffer(
            offer,
            accountUserRealtoken,
            chainId
          );

          /* const hasPropertyToken = propertiesToken.find(
            (propertyToken) =>
              propertyToken.contractAddress == offerData.buyerTokenAddress ||
              propertyToken.contractAddress == offerData.offerTokenAddress
          ); */
          //offerData.hasPropertyToken = hasPropertyToken ? true : false;

          offerData.hasPropertyToken =
            BigNumber(offerData.buyerTokenType).eq(1) ||
            BigNumber(offerData.offerTokenType).eq(1);

          offersData.push({ ...offerData });
        })
      );

      console.log('Offers formated', offersData.length);

      resolve(offersData);
    } catch (err) {
      console.log('Error while fetching offers from TheGraph', err);
      reject(err);
    }
  });
};