# M6: Cloud Deployment

## Reflections & Conclusion

Preparing the poster was pretty fun. It forced us to be very clear on our understanding of our architecture / design so we could highlight the most important components of our project appropriately. Our project originally was supposed to be a search on engineering tech blogs, but we had to pivot to Github READMEs after realizing we didn't have enough usable data for the original plan.

It was a fun experience figuring out the best way to organize the poster with the limited space that we had. Our final poster framed the system as a GitHub README discovery engine with a coordinator seeder, a coordinator crawler, a distributed frontier store, a distributed docs store, a distributed MapReduce indexer, a distributed inverted index, and a frontend/query engine. Once we organized the project this way, the overall flow became a lot easier to digest.

In terms of design decisions, we realized that maintaining a distributed crawler was more difficult than anticipated (since we had to keep track of duplications, race conditions, etc), so we ended up sticking with a single crawler for simplicity, choosing to reserve the distributed work for indexing. We also realized that it was a lot easier to parse and reason about a structured domain like Github READMEs compared to a less consistent set of engineering blogs.

## Roughly, how many hours did M6 take you to complete?

Hours: 20

## How many LoC did the distributed version of the project end up taking?

DLoC: ~6000


## How does this number compare with your non-distributed version?

LoC: ~600

The distributed version is around 10x larger than the non distributed version. This more or less checked out with the estimates that we originally had (5000-8000). Most of the increase seemed to stem from the infrastructure rather than the search logic itself. 

## How different are these numbers for different members in the team and why?

We worked on most of the design / programming in a pair programming format, so the work was split relatively equally. Though perhaps less efficient, we intentionally did it this way because both of us wanted to understand the full system rather than becoming isolated to just one subsystem. Since it was only a team of 2, we prioritized building a straightforward working solution that would let both of us gain experience across the entire project instead of dividing the work too aggressively.