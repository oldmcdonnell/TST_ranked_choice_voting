from collections import Counter

voting_round = 1
rank = 0

candidates = []

candidate_votes = select_candidate(iWantYou)

total_votes = Counter(candidate_votes)

#add candidates but do not allow duplicates
def add_candidate(x):
    x = input("Please ender candidate name")
    if(x != candidates):
        candidates.append()
        print(x + "has been added")
    else:
        print("That candidate has already been nominated")

#only allow votes in a round if less than 50%
def votes(candidate_votes):
    if candidate_votes  < total_votes/2:
        voting_round + 1
    else:
        print("winner")

# The amount of candidates you can choose from grows when new candidates are added, limit 20, If there are 20 candidates
# then you can select your favorite 1 - 20 or just 1 and submit vote
def select_candidate(iWantYou, x, y):
    x = voting_round(rank +1)
    iWantYou = candidates[x]


print("please choose your candidate or add a write in")
if candidates == 0:
        add_candidate(input()):
    elif:
        candidates < 20:
        match user_action:
            case select:
                select_candidate()
            case add:
            add_candidate()
else:
    print("too many candidates")

